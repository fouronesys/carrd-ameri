'use strict';

// PostgreSQL, archivos y credenciales desechables; SMTP solo en memoria.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');

test('Evidencia HTTP y PostgreSQL: respuesta perdida, concurrencia y correo sin duplicados', { timeout: 60000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evidencia-'));
  const pgdir = path.join(tmp, 'pg');
  const env = { PATH: process.env.PATH, HOME: tmp, LANG: 'C.UTF-8' };
  function ejecutar(cmd, args) {
    const r = spawnSync(cmd, args, { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr || r.stdout);
  }
  const socket = net.createServer().listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(r => socket.close(r));
  let db, servidor, started = false;
  const correos = [];
  let falloSmtp = false, pausaSmtp = null;
  try {
    ejecutar('initdb', ['-D', pgdir, '-A', 'trust', '-U', 'test', '--no-locale']);
    ejecutar('pg_ctl', ['-D', pgdir, '-l', path.join(tmp, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -k ${tmp}`, '-w', 'start']);
    started = true;
    Object.assign(process.env, {
      POSTGRES_URL: `postgresql://test@127.0.0.1:${port}/postgres`, DATABASE_URL: '',
      PGSSL: 'false', DATA_DIR: path.join(tmp, 'data'), NODE_ENV: 'test',
      ADMIN_PASSWORD: 'isolated-admin-test', ASSISTANT_PASSWORD: 'isolated-assistant-test',
      SESSION_SECRET: 'isolated-session-test-not-live',
      SMTP_HOST: 'smtp.example.invalid', SMTP_PORT: '587', SMTP_FROM: 'emisor@example.invalid',
      SMTP_PASS: 'synthetic-not-a-secret', NOTIFY_TO: 'nadie@example.invalid',
    });
    const nodemailer = require('nodemailer');
    nodemailer.createTransport = () => ({
      sendMail: async mail => {
        if (mail.subject.includes('evidencia')) {
          correos.push(mail);
          if (pausaSmtp) await pausaSmtp;
          if (falloSmtp) throw new Error('SMTP simulado no confirma');
        }
        return { messageId: 'synthetic-message', accepted: mail.to ? [mail.to] : [], rejected: [] };
      },
    });
    const session = require('express-session');
    const id = require.resolve('connect-pg-simple');
    require.cache[id] = { id, filename: id, loaded: true, exports: () => session.MemoryStore };
    db = require('../lib/db');
    await db.init();
    await db.init();
    await db.pool.query(`INSERT INTO clientes(id, email, data) VALUES
      ('CLIENTE', 'cliente@example.invalid', '{"email":"cliente@example.invalid"}')`);
    for (const ref of ['PERDIDA', 'DOBLE', 'ERROR', 'SIN-CORREO', 'ROLLBACK', 'ESTADO']) {
      await db.crearAgendamiento({ ref, estado: 'agendado', precio_cop: 45000,
        cliente_id: ref === 'SIN-CORREO' ? '' : 'CLIENTE', evidencia_fotos: [], producto: 'Prueba aislada' });
    }
    const { app } = require('../server');
    // Simula que el cliente pierde la conexión justo cuando el servidor confirma.
    app.request.get = (function (get) {
      return function (header) {
        if (header.toLowerCase() === 'accept' && this.headers['x-perder-respuesta']) {
          this.res.json = function () { this.destroy(); return this; };
        }
        return get.call(this, header);
      };
    })(app.request.get);
    servidor = app.listen(0, '127.0.0.1');
    await once(servidor, 'listening');
    const base = 'http://127.0.0.1:' + servidor.address().port;
    async function login(password, usuario = '') {
      const r = await fetch(base + '/admin/login', {
        method: 'POST', redirect: 'manual', headers: { Origin: base },
        body: new URLSearchParams({ password, usuario }),
      });
      assert.equal(r.status, 302);
      return r.headers.get('set-cookie').split(';')[0];
    }
    const cookie = await login('isolated-admin-test');
    async function enviar(ref, clave, opciones = {}) {
      const body = new FormData();
      if (clave !== undefined) body.append('operacion', clave);
      body.append('notas', opciones.notas || 'Nota sintética');
      body.append('fotos', new Blob([opciones.foto || 'imagen-sintetica'], { type: 'image/png' }), 'prueba.png');
      return fetch(base + '/admin/evidencia/' + ref, {
        method: 'POST', redirect: 'manual', body,
        headers: { Accept: 'application/json', Origin: base, Cookie: cookie, ...opciones.headers },
      });
    }
    const cantidad = () => fs.readdirSync(db.UPLOADS_DIR).length;
    const clave = randomUUID();
    await assert.rejects(enviar('PERDIDA', clave, { headers: { 'X-Perder-Respuesta': '1' } }));
    const original = await db.obtenerPorRef('PERDIDA');
    assert.equal(original.evidencia_fotos.length, 1);
    assert.equal(correos.length, 1);
    assert.equal(fs.readFileSync(path.join(db.UPLOADS_DIR, original.evidencia_fotos[0]), 'utf8'), 'imagen-sintetica');
    const repetida = await (await enviar('PERDIDA', clave)).json();
    assert.equal(repetida.repetida, true);
    assert.equal(repetida.correo, 'enviado');
    assert.deepEqual(await db.obtenerPorRef('PERDIDA'), original);
    assert.equal(cantidad(), 1, 'Se elimina solo la copia temporal del reintento');
    assert.equal(correos.length, 1);
    assert.equal((await enviar('PERDIDA', clave, { notas: 'Otro contenido' })).status, 409);
    assert.equal((await enviar('PERDIDA', clave, { foto: 'otra imagen' })).status, 409);
    assert.equal(cantidad(), 1);
    assert.equal((await (await enviar('PERDIDA', randomUUID())).json()).repetida, false);
    assert.equal((await db.obtenerPorRef('PERDIDA')).evidencia_fotos.length, 2);
    assert.equal(correos.length, 2, 'Una clave nueva sí representa otro envío intencional');
    let continuar;
    pausaSmtp = new Promise(r => { continuar = r; });
    const dobleClave = randomUUID();
    const primera = enviar('DOBLE', dobleClave);
    while (correos.length < 3) await new Promise(r => setTimeout(r, 10));
    const limpiezaActiva = await db.limpiarUploadsHuerfanos({ simular: false, ahora: Date.now() + 25 * 3600000 });
    assert.equal(limpiezaActiva.omitida, 'subidas_o_limpieza_activas',
      'La protección dura hasta completar el callback, incluso durante SMTP');
    const doble = await (await enviar('DOBLE', dobleClave)).json();
    assert.equal(doble.repetida, true);
    assert.equal(doble.correo, 'en_proceso');
    assert.equal(correos.length, 3);
    continuar();
    await primera;
    pausaSmtp = null;
    assert.equal((await db.obtenerPorRef('DOBLE')).evidencia_fotos.length, 1);
    assert.equal((await (await enviar('DOBLE', dobleClave)).json()).correo, 'enviado');
    falloSmtp = true;
    const errorClave = randomUUID();
    assert.equal((await (await enviar('ERROR', errorClave)).json()).correo, 'no_confirmado');
    const antes = correos.length;
    falloSmtp = false;
    assert.equal((await (await enviar('ERROR', errorClave)).json()).correo, 'no_confirmado');
    assert.equal(correos.length, antes, 'Un reintento explícito nunca repite un SMTP ambiguo');
    assert.equal((await (await enviar('SIN-CORREO', randomUUID())).json()).correo, 'sin_destinatario');
    assert.equal(correos.length, antes);
    // Recuperar un aviso automático de entrega no autoriza a repetir evidencia
    // manual cuyo SMTP quedó ambiguo, ni altera sus operaciones o adjuntos.
    const evidenciaAntes = await db.obtenerPorRef('ERROR');
    const operacionAntes = (await db.pool.query('SELECT * FROM evidencia_operaciones WHERE ref=$1 AND clave=$2',
      ['ERROR', errorClave])).rows[0];
    const fotosAntes = cantidad();
    await db.marcarTrabajoRealizado('ERROR');
    await db.eliminarPorRef('ERROR');
    await db.procesarSiguienteAvisoRealizado(() => assert.fail('Un eliminado no debe enviar correo'));
    assert.equal((await db.pool.query("SELECT estado FROM avisos_realizado WHERE ref='ERROR'")).rows[0].estado, 'cancelado');
    for (let i = 0; i < 2; i++) {
      assert.equal((await fetch(base + '/admin/restaurar/ERROR', {
        method: 'POST', redirect: 'manual', headers: { Cookie: cookie, Origin: base },
      })).status, 302);
    }
    for (let i = 0; i < 200; i++) {
      if ((await db.pool.query("SELECT estado FROM avisos_realizado WHERE ref='ERROR'")).rows[0].estado === 'enviado') break;
      await new Promise(r => setTimeout(r, 10));
    }
    assert.equal((await db.pool.query("SELECT estado FROM avisos_realizado WHERE ref='ERROR'")).rows[0].estado, 'enviado');
    assert.deepEqual((await db.pool.query('SELECT * FROM evidencia_operaciones WHERE ref=$1 AND clave=$2',
      ['ERROR', errorClave])).rows[0], operacionAntes);
    assert.deepEqual((await db.obtenerPorRef('ERROR')).evidencia_fotos, evidenciaAntes.evidencia_fotos);
    assert.equal(cantidad(), fotosAntes);
    assert.equal(correos.length, antes, 'Restaurar solo envía el aviso de entrega, no la evidencia manual');
    const archivosAntes = cantidad();
    assert.equal((await enviar('NO-EXISTE', randomUUID())).status, 404);
    assert.equal((await enviar('PERDIDA', undefined)).status, 400);
    assert.equal((await enviar('PERDIDA', 'clave-invalida')).status, 400);
    assert.equal(cantidad(), archivosAntes);
    const asistente = await login('isolated-assistant-test');
    assert.equal((await enviar('PERDIDA', randomUUID(), { headers: { Cookie: asistente } })).status, 403);
    assert.equal(cantidad(), archivosAntes);
    // No marcar enviado antes de SMTP: si falla la confirmación, el replay
    // conserva evidencia y evita un segundo correo incluso tras reiniciar el pool.
    const finalizar = db.finalizarCorreoEvidencia;
    db.finalizarCorreoEvidencia = async () => { throw new Error('Fallo simulado al confirmar estado'); };
    const estadoClave = randomUUID();
    assert.equal((await enviar('ESTADO', estadoClave)).status, 500);
    db.finalizarCorreoEvidencia = finalizar;
    const enviados = correos.length;
    assert.equal((await (await enviar('ESTADO', estadoClave)).json()).correo, 'en_proceso');
    assert.equal(correos.length, enviados);
    // Rollback conjunto de reserva + evidencia ante errores del almacenamiento.
    await db.pool.query(`CREATE FUNCTION fallar_evidencia() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'rollback simulado'; END $$;
      CREATE TRIGGER fallar_evidencia BEFORE UPDATE ON agendamientos
      FOR EACH ROW WHEN (OLD.ref = 'ROLLBACK') EXECUTE FUNCTION fallar_evidencia()`);
    const rollbackClave = randomUUID();
    await assert.rejects(db.guardarEvidencia('ROLLBACK', rollbackClave, 'huella', [], 'nota'), /rollback simulado/);
    assert.equal((await db.pool.query('SELECT * FROM evidencia_operaciones WHERE ref = $1', ['ROLLBACK'])).rowCount, 0);
    await db.pool.query('DROP TRIGGER fallar_evidencia ON agendamientos');
    // Dos operaciones distintas conservan ambos adjuntos y el resto del registro.
    await Promise.all([enviar('ROLLBACK', randomUUID()), enviar('ROLLBACK', randomUUID())]);
    const final = await db.obtenerPorRef('ROLLBACK');
    assert.equal(final.evidencia_fotos.length, 2);
    assert.equal(final.precio_cop, 45000);
    assert.equal(final.estado, 'agendado');
    // La consulta sobrevive a recargas y usa las operaciones, no la última
    // evidencia del trabajo. Incluye entregados y eliminados temporalmente.
    await db.actualizarPorRef('ERROR', { eliminado_en: new Date().toISOString() });
    await db.actualizarPorRef('ESTADO', { trabajo_hecho: true });
    let pendientes = await db.listarCorreosEvidenciaPendientes();
    assert.deepEqual(new Set(pendientes.operaciones.map(op => op.ref)), new Set(['ERROR', 'ESTADO']));
    assert.equal(pendientes.hayMas, false);
    for (const op of pendientes.operaciones) {
      assert.deepEqual(Object.keys(op).sort(), ['clave', 'correo', 'creado_en', 'gestiones_negativas', 'recepcion_verificada_en', 'recepcion_verificada_por', 'ref']);
      assert.deepEqual(op.gestiones_negativas, []);
      assert.equal(op.recepcion_verificada_en, null);
      assert.equal(op.recepcion_verificada_por, null);
      assert.ok(op.creado_en instanceof Date);
    }
    const { parseHTML } = require('linkedom');
    const consulta = '/admin?tab=correos_evidencia';
    const seccion = html => parseHTML(html).document.querySelector('[data-sec="correos_evidencia"]');
    const archivosConsulta = cantidad();
    const correosConsulta = correos.length;
    for (let recarga = 0; recarga < 2; recarga++) {
      const r = await fetch(base + consulta, { headers: { Cookie: cookie } });
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('cache-control'), 'no-store');
      const panel = seccion(await r.text());
      assert.ok(panel.classList.contains('activo'));
      assert.match(panel.textContent, /ERROR/);
      assert.match(panel.textContent, /ESTADO/);
      assert.match(panel.textContent, /en_proceso/);
      assert.match(panel.textContent, /no_confirmado/);
      assert.match(panel.textContent, /verifica la recepción/);
      assert.equal(panel.querySelectorAll('tbody tr').length, 2);
      assert.equal(panel.querySelector('img, input[type=file]'), null);
      assert.equal(panel.querySelectorAll('form').length, 4);
      for (const form of panel.querySelectorAll('form')) {
        assert.equal(form.getAttribute('method').toLowerCase(), 'post');
        assert.ok(form.querySelector('input[name=operacion]').value);
        assert.ok(form.querySelector('input[type=checkbox][required]'));
        assert.match(form.getAttribute('action'), /\/(verificar-recepcion|no-recibida)$/);
        if (form.getAttribute('action').endsWith('/no-recibida')) {
          assert.match(form.querySelector('input[name=gestion]').value, /^[0-9a-f-]{36}$/);
          assert.equal(form.querySelector('input[type=checkbox]').name, 'contacto_confirmado');
        }
      }
    }
    for (const headers of [{}, { Cookie: asistente }]) {
      const r = await fetch(base + consulta, { headers });
      const html = await r.text();
      assert.equal(seccion(html), null);
      assert.equal(html.includes('Correos de evidencia'), false);
    }
    assert.equal(correos.length, correosConsulta, 'Consultar y recargar no envía SMTP');
    assert.equal(cantidad(), archivosConsulta, 'Consultar no vuelve a adjuntar fotos');
    // Una operación posterior confirmada no oculta una anterior ambigua.
    const posterior = await db.guardarEvidencia('ERROR', randomUUID(), 'posterior', [], '');
    await db.finalizarCorreoEvidencia('ERROR', posterior.operacion.clave, 'enviado');
    assert.equal((await db.listarCorreosEvidenciaPendientes()).operaciones.length, 2);
    await db.crearAgendamiento({ ref: '<img src=x onerror=alert(1)>', estado: 'agendado' });
    await db.guardarEvidencia('<img src=x onerror=alert(1)>', randomUUID(), 'xss', [], '');
    const xss = seccion(await (await fetch(base + consulta, { headers: { Cookie: cookie } })).text());
    assert.equal(xss.querySelector('img'), null);
    assert.ok(xss.textContent.includes('<img src=x onerror=alert(1)>'));
    // Varias operaciones de la misma referencia se conservan por separado.
    for (let i = 0; i < 26; i++) await db.guardarEvidencia('ESTADO', randomUUID(), 'paginacion-' + i, [], '');
    const primeraPagina = await db.listarCorreosEvidenciaPendientes();
    const segundaPagina = await db.listarCorreosEvidenciaPendientes(2);
    assert.equal(primeraPagina.operaciones.length, 25);
    assert.equal(primeraPagina.hayMas, true);
    assert.equal(segundaPagina.operaciones.length, 4);
    assert.equal(segundaPagina.hayMas, false);
    for (const invalida of ['basura', '-1', '1.5', 'Infinity']) {
      assert.equal((await db.listarCorreosEvidenciaPendientes(invalida)).pagina, 1);
    }
    const paginaDos = seccion(await (await fetch(base + consulta + '&ev_pagina=2', { headers: { Cookie: cookie } })).text());
    assert.equal(paginaDos.querySelectorAll('tbody tr').length, 4);
    assert.match(paginaDos.textContent, /Página 2/);
    assert.ok(paginaDos.querySelector('a[href$="ev_pagina=1"]'));
    // Migración de operaciones históricas: no fabricar fecha ni autor.
    await db.pool.query('DROP TABLE evidencia_gestiones_negativas');
    await db.pool.query(`ALTER TABLE evidencia_operaciones
      DROP COLUMN recepcion_verificada_en, DROP COLUMN recepcion_verificada_por`);
    // init se ejecuta una vez por proceso: cargar otra instancia simula
    // un arranque nuevo contra un esquema anterior.
    const moduloDb = require.cache[require.resolve('../lib/db')];
    delete require.cache[require.resolve('../lib/db')];
    const migracion = require('../lib/db');
    try {
      await migracion.init();
      await migracion.init();
    } finally {
      await migracion.cerrar();
      require.cache[require.resolve('../lib/db')] = moduloDb;
    }
    assert.equal((await db.listarCorreosEvidenciaPendientes()).operaciones[0].recepcion_verificada_en, null);
    assert.deepEqual((await db.listarCorreosEvidenciaPendientes()).operaciones[0].gestiones_negativas, []);
    const verificar = (ref, clave, opciones = {}) => fetch(base + '/admin/evidencia/' + encodeURIComponent(ref) + '/verificar-recepcion', {
      method: 'POST', redirect: 'manual',
      headers: { Cookie: cookie, Origin: base, ...opciones.headers },
      body: new URLSearchParams({ operacion: clave, recepcion_confirmada: 'si', ...opciones.body }),
    });
    const snapshot = (await db.pool.query('SELECT * FROM evidencia_operaciones WHERE ref = $1 AND clave = $2', ['ERROR', errorClave])).rows[0];
    const registroAntes = await db.obtenerPorRef('ERROR');
    const sinEfectos = { correos: correos.length, archivos: cantidad() };
    const noRecibida = (ref, clave, gestion, opciones = {}) => fetch(base + '/admin/evidencia/' + encodeURIComponent(ref) + '/no-recibida', {
      method: 'POST', redirect: 'manual',
      headers: { Cookie: cookie, Origin: base, ...opciones.headers },
      body: new URLSearchParams({ operacion: clave, gestion, contacto_confirmado: 'si', ...opciones.body }),
    });
    const gestion = randomUUID();
    await assert.rejects(db.registrarNoRecepcionEvidencia('ERROR', errorClave, gestion,
      { rol: 'asistente', usuario: 'asistente' }), { status: 403 });
    for (const headers of [{ Cookie: '' }, { Cookie: asistente }, { Origin: 'https://otro.example.invalid' }, { Origin: '' }]) {
      assert.ok([302, 403].includes((await noRecibida('ERROR', errorClave, gestion, { headers })).status));
    }
    for (const body of [{ contacto_confirmado: '' }, { operacion: 'invalida' }, { gestion: '' }, { gestion: ['no-uuid'] }]) {
      assert.equal((await noRecibida('ERROR', errorClave, gestion, { body })).status, 400);
    }
    assert.equal((await noRecibida('NO-EXISTE', errorClave, gestion)).status, 404);
    assert.equal((await noRecibida('ERROR', randomUUID(), gestion)).status, 404);
    assert.equal((await noRecibida('PERDIDA', clave, gestion)).status, 409);
    assert.equal((await db.pool.query('SELECT * FROM evidencia_gestiones_negativas')).rowCount, 0);
    await db.pool.query(`CREATE FUNCTION fallar_gestion() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'gestión no guardada'; END $$;
      CREATE TRIGGER fallar_gestion BEFORE INSERT ON evidencia_gestiones_negativas
      FOR EACH ROW EXECUTE FUNCTION fallar_gestion()`);
    assert.equal((await noRecibida('ERROR', errorClave, gestion)).status, 500);
    assert.equal((await db.pool.query('SELECT * FROM evidencia_gestiones_negativas')).rowCount, 0);
    await db.pool.query('DROP TRIGGER fallar_gestion ON evidencia_gestiones_negativas');
    for (const r of await Promise.all([
      noRecibida('ERROR', errorClave, gestion, { body: { usuario: 'impostor', creado_en: '2000-01-01' } }),
      noRecibida('ERROR', errorClave, gestion),
    ])) {
      assert.equal(r.status, 303);
      assert.match(r.headers.get('location'), /tab=correos_evidencia&ok=/);
      assert.equal(r.headers.get('cache-control'), 'no-store');
    }
    const gestionGuardada = (await db.pool.query('SELECT * FROM evidencia_gestiones_negativas')).rows[0];
    assert.equal((await db.pool.query('SELECT * FROM evidencia_gestiones_negativas')).rowCount, 1);
    assert.ok(gestionGuardada.creado_en >= snapshot.creado_en);
    assert.deepEqual(gestionGuardada.cuenta, { usuario: 'administrador', usuario_id: null, rol: 'admin' });
    assert.deepEqual((await db.pool.query('SELECT * FROM evidencia_operaciones WHERE ref=$1 AND clave=$2', ['ERROR', errorClave])).rows[0], snapshot);
    assert.deepEqual(await db.obtenerPorRef('ERROR'), registroAntes);
    assert.deepEqual({ correos: correos.length, archivos: cantidad() }, sinEfectos);
    let opPendiente = (await db.listarCorreosEvidenciaPendientes(2)).operaciones.find(op => op.clave === errorClave);
    assert.ok(opPendiente);
    assert.equal(opPendiente.gestiones_negativas.length, 1);
    // El formulario real genera una nueva clave para un nuevo contacto, no otro envío.
    let formularioNegativo;
    for (let recarga = 0; recarga < 2; recarga++) {
      const panel = seccion(await (await fetch(base + consulta + '&ev_pagina=2', { headers: { Cookie: cookie } })).text());
      const fila = [...panel.querySelectorAll('tbody tr')].find(tr => tr.textContent.includes(errorClave));
      assert.match(fila.textContent, /Cliente contactado: no recibió/);
      assert.match(fila.textContent, /acceso general compartido/);
      assert.ok(fila.textContent.includes(gestion));
      assert.ok(fila.querySelector('form[action$="/verificar-recepcion"]'));
      formularioNegativo = fila.querySelector('form[action$="/no-recibida"]');
    }
    await assert.rejects(db.verificarRecepcionEvidencia('ERROR', errorClave, { rol: 'asistente', usuario: 'asistente' }), { status: 403 });
    for (const headers of [{ Cookie: '' }, { Cookie: asistente }, { Origin: 'https://otro.example.invalid' }, { Origin: '' }]) {
      assert.ok([302, 403].includes((await verificar('ERROR', errorClave, { headers })).status));
    }
    for (const body of [{ recepcion_confirmada: '' }, { operacion: 'invalida' }, { operacion: '' }]) {
      assert.equal((await verificar('ERROR', errorClave, { body })).status, 400);
    }
    assert.equal((await verificar('NO-EXISTE', errorClave)).status, 404);
    assert.equal((await verificar('ERROR', randomUUID())).status, 404);
    assert.equal((await verificar('PERDIDA', clave)).status, 409);
    assert.equal((await db.pool.query('SELECT recepcion_verificada_en FROM evidencia_operaciones WHERE ref=$1 AND clave=$2', ['ERROR', errorClave])).rows[0].recepcion_verificada_en, null);
    const confirmaciones = await Promise.all([verificar('ERROR', errorClave), verificar('ERROR', errorClave)]);
    for (const r of confirmaciones) {
      assert.equal(r.status, 303);
      assert.match(r.headers.get('location'), /ev_vista=verificadas/);
    }
    const opVerificada = (await db.pool.query('SELECT * FROM evidencia_operaciones WHERE ref=$1 AND clave=$2', ['ERROR', errorClave])).rows[0];
    assert.ok(opVerificada.recepcion_verificada_en instanceof Date);
    assert.ok(opVerificada.recepcion_verificada_en >= snapshot.creado_en);
    assert.deepEqual(opVerificada.recepcion_verificada_por, { usuario: 'administrador', usuario_id: null, rol: 'admin' });
    for (const campo of Object.keys(snapshot).filter(campo => !campo.startsWith('recepcion_'))) {
      assert.deepEqual(opVerificada[campo], snapshot[campo], campo + ' se conserva');
    }
    // Identidad derivada de sesión, no de campos enviados; autor nominal
    // persistido aun después de renombrar o eliminar la cuenta.
    const { scryptSync } = require('node:crypto');
    await db.crearUsuarioAdmin({ id: 'admin-verificador', usuario: 'verificador', rol: 'admin',
      salt: 'sal-sintetica', hash: scryptSync('clave-sintetica', 'sal-sintetica', 64).toString('hex') });
    const nominal = await login('clave-sintetica', 'verificador');
    // Un contacto posterior tiene su propia cuenta/fecha y no borra el primero.
    const segundaGestion = formularioNegativo.querySelector('input[name=gestion]').value;
    // ERROR ya fue verificada: la acción de una pestaña antigua debe rechazarse.
    assert.equal((await noRecibida('ERROR', errorClave, segundaGestion)).status, 409);
    assert.equal((await noRecibida('ERROR', errorClave, gestion, { headers: { Cookie: nominal } })).status, 303);
    assert.deepEqual((await db.pool.query('SELECT * FROM evidencia_gestiones_negativas WHERE gestion=$1', [gestion])).rows[0], gestionGuardada);
    const gestionNominal = randomUUID();
    assert.equal((await noRecibida('ESTADO', estadoClave, gestionNominal, { headers: { Cookie: nominal },
      body: { usuario: '<img src=x onerror=alert(1)>', usuario_id: 'impostor', creado_en: '2000-01-01' } })).status, 303);
    const otraGestion = randomUUID();
    assert.equal((await noRecibida('ESTADO', estadoClave, otraGestion)).status, 303);
    opPendiente = (await db.listarCorreosEvidenciaPendientes(2)).operaciones.find(op => op.clave === estadoClave);
    assert.equal(opPendiente.gestiones_negativas.length, 2);
    assert.equal(opPendiente.gestiones_negativas[0].gestion, otraGestion);
    const nominalGuardada = opPendiente.gestiones_negativas.find(g => g.gestion === gestionNominal);
    assert.deepEqual(nominalGuardada.cuenta, { usuario: 'verificador', usuario_id: 'admin-verificador', rol: 'admin' });
    assert.equal((await verificar('ESTADO', estadoClave, { headers: { Cookie: nominal },
      body: { usuario: 'impostor', usuario_id: 'otro', recepcion_verificada_en: '2000-01-01' } })).status, 303);
    await db.eliminarUsuarioAdmin('admin-verificador');
    // Un SMTP tardío puede terminar después de la verificación, sin borrarla.
    await db.finalizarCorreoEvidencia('ESTADO', estadoClave, 'no_confirmado');
    assert.equal((await verificar('ERROR', errorClave, { headers: { Cookie: nominal } })).status, 303);
    assert.deepEqual((await db.pool.query('SELECT * FROM evidencia_operaciones WHERE ref=$1 AND clave=$2', ['ERROR', errorClave])).rows[0], opVerificada);
    assert.deepEqual(await db.obtenerPorRef('ERROR'), registroAntes);
    assert.deepEqual({ correos: correos.length, archivos: cantidad() }, sinEfectos);
    // Leer desde una conexión nueva prueba persistencia, no estado en memoria.
    const { Pool } = require('pg');
    const lectura = new Pool({ connectionString: `postgresql://test@127.0.0.1:${port}/postgres`, ssl: false });
    try {
      assert.deepEqual((await lectura.query('SELECT * FROM evidencia_operaciones WHERE ref=$1 AND clave=$2', ['ERROR', errorClave])).rows[0], opVerificada);
      assert.deepEqual((await lectura.query('SELECT * FROM evidencia_gestiones_negativas WHERE gestion=$1', [gestion])).rows[0], gestionGuardada);
    } finally { await lectura.end(); }
    for (let recarga = 0; recarga < 2; recarga++) {
      const historial = seccion(await (await fetch(base + consulta + '&ev_vista=verificadas', { headers: { Cookie: cookie } })).text());
      assert.equal(historial.querySelectorAll('tbody tr').length, 2);
      assert.equal(historial.querySelector('form[method="POST"]'), null);
      assert.equal(historial.querySelector('form[method="GET"]').getAttribute('action'), '/admin');
      assert.match(historial.textContent, /administrador|Administrador/);
      assert.match(historial.textContent, /acceso general compartido/);
      assert.match(historial.textContent, /verificador/);
      assert.match(historial.textContent, /admin-verificador/);
      assert.match(historial.textContent, /no_confirmado/);
      assert.ok(historial.textContent.includes(errorClave));
      assert.ok(historial.textContent.includes(gestion));
      assert.ok(historial.textContent.includes(gestionNominal));
      assert.ok(historial.textContent.includes(otraGestion));
      assert.match(historial.textContent, /Cliente contactado: no recibió/);
      assert.equal(historial.querySelector('img'), null);
    }
    assert.equal((await db.listarCorreosEvidenciaPendientes(1, 'verificadas')).operaciones.length, 2);
    assert.equal((await db.listarCorreosEvidenciaPendientes()).operaciones.some(op => op.clave === errorClave), false);
    for (const headers of [{}, { Cookie: asistente }]) {
      const r = await fetch(base + consulta + '&ev_vista=verificadas', { headers });
      assert.equal(seccion(await r.text()), null);
    }
    // Paginación independiente del historial, incluso para un mismo trabajo.
    const resto = (await db.pool.query(`SELECT ref, clave FROM evidencia_operaciones WHERE recepcion_verificada_en IS NULL AND correo IN ('en_proceso','no_confirmado')`)).rows;
    for (const op of resto) await verificar(op.ref, op.clave);
    const historialDos = seccion(await (await fetch(base + consulta + '&ev_vista=verificadas&ev_pagina=2', { headers: { Cookie: cookie } })).text());
    assert.equal(historialDos.querySelectorAll('tbody tr').length, 4);
    assert.ok(historialDos.querySelector('a[href$="ev_vista=verificadas&ev_pagina=1"]'));
    assert.equal(historialDos.querySelector('img'), null);
    assert.deepEqual({ correos: correos.length, archivos: cantidad() }, sinEfectos);
    // Fechas de verificación (no de creación), días completos de Colombia.
    await db.pool.query(`UPDATE evidencia_operaciones SET recepcion_verificada_en = '2026-11-17T17:00:00Z'
      WHERE recepcion_verificada_en IS NOT NULL`);
    await db.pool.query(`UPDATE evidencia_operaciones SET recepcion_verificada_en = '2026-11-17T04:59:59.999Z'
      WHERE ref=$1 AND clave=$2`, ['ERROR', errorClave]);
    await db.pool.query(`UPDATE evidencia_operaciones SET recepcion_verificada_en = '2026-11-18T05:00:00Z'
      WHERE ref=$1 AND clave=$2`, ['ESTADO', estadoClave]);
    const buscar = filtros => db.listarCorreosEvidenciaPendientes(1, 'verificadas', filtros);
    assert.deepEqual(new Set((await buscar({ ref: 'eRrOr' })).operaciones.map(op => op.ref)),
      new Set(['ERROR', '<img src=x onerror=alert(1)>']), 'La referencia se busca por fragmento literal');
    assert.equal((await buscar({ cuenta: 'admin-verificador' })).operaciones[0].clave, estadoClave,
      'Busca el ID histórico de una cuenta eliminada');
    assert.equal((await buscar({ cuenta: 'admin-verificador' })).operaciones[0].gestiones_negativas.length, 2,
      'Filtrar verificaciones conserva los contactos negativos de esa operación');
    assert.equal((await buscar({ cuenta: 'VERIFICADOR' })).operaciones[0].clave, estadoClave);
    assert.deepEqual((await buscar({ desde: '2026-11-16', hasta: '2026-11-16' })).operaciones.map(op => op.clave), [errorClave]);
    assert.deepEqual((await buscar({ desde: '2026-11-18', hasta: '2026-11-18' })).operaciones.map(op => op.clave), [estadoClave]);
    assert.equal((await buscar({ desde: '2026-11-18' })).operaciones.length, 1);
    assert.equal((await buscar({ hasta: '2026-11-16' })).operaciones.length, 1);
    assert.equal((await buscar({ ref: 'ERROR', cuenta: 'verificador' })).operaciones.length, 0);
    for (const literal of ['%', '_', "' OR 1=1 --"]) {
      assert.equal((await buscar({ ref: literal })).operaciones.length, 0);
      assert.equal((await buscar({ cuenta: literal })).operaciones.length, 0);
    }
    const historialUrl = consulta + '&ev_vista=verificadas';
    for (const filtros of [
      { desde: '2026-02-30' }, { hasta: 'ayer' }, { desde: '2026-13-01' },
      { hasta: '0000-01-01' }, { desde: '2026-11-18', hasta: '2026-11-17' },
    ]) {
      await assert.rejects(buscar(filtros), { status: 400 });
      const params = new URLSearchParams(Object.entries(filtros).map(([k, v]) => ['ev_' + k, v]));
      const invalida = await fetch(base + historialUrl + '&' + params, { headers: { Cookie: cookie } });
      assert.equal(invalida.status, 400);
      assert.equal(invalida.headers.get('cache-control'), 'no-store');
    }
    const filtros = { ref: 'estado', desde: '2026-11-17', hasta: '2026-11-17', cuenta: 'administrador' };
    assert.equal((await buscar(filtros)).hayMas, true);
    const filtradaUrl = historialUrl + '&' + new URLSearchParams(
      Object.entries(filtros).map(([k, v]) => ['ev_' + k, v]));
    const cargarPanel = async url => seccion(await (await fetch(base + url, { headers: { Cookie: cookie } })).text());
    const filtrada = await cargarPanel(filtradaUrl + '&ev_pagina=1');
    assert.equal(filtrada.querySelectorAll('tbody tr').length, 25);
    const formFiltros = filtrada.querySelector('form[method="GET"]');
    assert.equal(formFiltros.querySelector('[name=ev_vista]').value, 'verificadas');
    assert.equal(formFiltros.querySelector('[name=tab]').value, 'correos_evidencia');
    assert.equal(formFiltros.querySelector('[name=ev_pagina]'), null, 'Aplicar filtros reinicia la página');
    for (const [campo, valor] of Object.entries(filtros)) {
      assert.equal(formFiltros.querySelector('[name=ev_' + campo + ']').value, valor);
    }
    const enlaces = panel => [...panel.querySelectorAll('a')];
    const siguiente = enlaces(filtrada).find(a => a.textContent === 'Siguiente').getAttribute('href');
    const segundaFiltrada = await cargarPanel(siguiente);
    assert.equal(segundaFiltrada.querySelectorAll('tbody tr').length, 1);
    const anterior = enlaces(segundaFiltrada).find(a => a.textContent === 'Anterior').getAttribute('href');
    const actualizar = enlaces(segundaFiltrada).find(a => a.textContent === 'Actualizar consulta').getAttribute('href');
    for (const [url, pagina] of [[siguiente, '2'], [anterior, '1'], [actualizar, '1']]) {
      const params = new URL(url, base).searchParams;
      assert.equal(params.get('ev_pagina'), pagina);
      for (const [campo, valor] of Object.entries(filtros)) assert.equal(params.get('ev_' + campo), valor);
    }
    const limpiar = enlaces(filtrada).find(a => a.textContent === 'Limpiar filtros').getAttribute('href');
    assert.equal(limpiar, historialUrl);
    assert.equal((await cargarPanel(limpiar)).querySelectorAll('tbody tr').length, 25);
    const sinResultados = await cargarPanel(historialUrl + '&ev_ref=NO-EXISTE');
    assert.match(sinResultados.textContent, /No hay operaciones/);
    assert.equal(enlaces(sinResultados).some(a => a.textContent === 'Siguiente'), false);
    const malicioso = '<img src=x onerror=alert(1)>&"';
    const segura = await cargarPanel(historialUrl + '&' + new URLSearchParams({ ev_ref: malicioso, ev_cuenta: malicioso }));
    assert.equal(segura.querySelector('img'), null);
    assert.equal(segura.querySelector('[name=ev_ref]').value, malicioso);
    const actualizarSeguro = enlaces(segura).find(a => a.textContent === 'Actualizar consulta').getAttribute('href');
    assert.equal(new URL(actualizarSeguro, base).searchParams.get('ev_cuenta'), malicioso);
    // Los filtros no dan acceso a asistentes ni visitantes; pendientes no los aplica.
    for (const headers of [{}, { Cookie: asistente }]) {
      assert.equal(seccion(await (await fetch(base + filtradaUrl, { headers })).text()), null);
    }
    assert.deepEqual((await db.listarCorreosEvidenciaPendientes(1, 'pendientes', filtros)).filtros, {});
    assert.deepEqual({ correos: correos.length, archivos: cantidad() }, sinEfectos,
      'Filtrar, paginar, limpiar y rechazar fechas no envía SMTP ni adjunta fotos');
    // Dos contactos nuevos de la misma operación se conservan, pero nunca se
    // añade una negativa después de una confirmación positiva concurrente.
    const carreraClave = randomUUID();
    await db.guardarEvidencia('ESTADO', carreraClave, 'carrera', [], '');
    for (const r of await Promise.all([
      noRecibida('ESTADO', carreraClave, randomUUID()),
      noRecibida('ESTADO', carreraClave, randomUUID()),
    ])) assert.equal(r.status, 303);
    const negativosAntes = (await db.pool.query(`SELECT * FROM evidencia_gestiones_negativas
      WHERE ref='ESTADO' AND clave=$1`, [carreraClave])).rows;
    assert.equal(negativosAntes.length, 2);
    const [positivaConcurrente, negativaConcurrente] = await Promise.all([
      verificar('ESTADO', carreraClave), noRecibida('ESTADO', carreraClave, randomUUID()),
    ]);
    assert.equal(positivaConcurrente.status, 303);
    assert.ok([303, 409].includes(negativaConcurrente.status));
    assert.equal((await noRecibida('ESTADO', carreraClave, randomUUID())).status, 409);
    const negativosDespues = (await db.pool.query(`SELECT g.*,
      o.recepcion_verificada_en FROM evidencia_gestiones_negativas g
      JOIN evidencia_operaciones o USING (ref, clave) WHERE g.ref='ESTADO' AND g.clave=$1`, [carreraClave])).rows;
    for (const g of negativosDespues) assert.ok(g.creado_en <= g.recepcion_verificada_en);
    assert.equal(negativosDespues.length, negativaConcurrente.status === 303 ? 3 : 2);
    // La gestión pertenece a esa operación, no a todas las evidencias del trabajo.
    assert.equal((await db.listarCorreosEvidenciaPendientes(1, 'verificadas')).operaciones
      .find(op => op.clave === carreraClave).gestiones_negativas.length, negativosDespues.length);
    await db.pool.query('UPDATE evidencia_operaciones SET correo = $1', ['enviado']);
    const vacia = seccion(await (await fetch(base + consulta, { headers: { Cookie: cookie } })).text());
    assert.match(vacia.textContent, /No hay operaciones/);
    // Errores de conexión antes/después del COMMIT: el controlador conserva
    // ambos archivos inicialmente, pero solo el no guardado es un huérfano.
    const conectar = db.pool.connect.bind(db.pool);
    async function conFalloCommit(despues, accion) {
      let inyectado = false;
      db.pool.connect = async function () {
        const client = await conectar();
        const query = client.query.bind(client);
        client.query = async function (sql, ...args) {
          if (!inyectado && sql === 'COMMIT') {
            inyectado = true;
            if (despues) await query(sql, ...args);
            // Cerrar realmente el transporte: antes del COMMIT PostgreSQL
            // revierte, después del COMMIT el registro debe seguir guardado.
            await new Promise(resolve => {
              client.once('error', resolve);
              client.connection.stream.destroy();
            });
            throw Object.assign(new Error('Conexión perdida en COMMIT (sintético)'), { code: 'ECONNRESET' });
          }
          return query(sql, ...args);
        };
        const release = client.release;
        client.release = function (...args) {
          client.query = query;
          return release.apply(client, args);
        };
        return client;
      };
      try { await accion(); assert.equal(inyectado, true); }
      finally { db.pool.connect = conectar; }
    }
    await db.crearAgendamiento({ ref: 'ANTES-COMMIT', evidencia_fotos: [] });
    await db.crearAgendamiento({ ref: 'DESPUES-COMMIT', evidencia_fotos: [] });
    const antesDeFallar = new Set(fs.readdirSync(db.UPLOADS_DIR));
    await conFalloCommit(false, async () => {
      assert.equal((await enviar('ANTES-COMMIT', randomUUID())).status, 500);
    });
    const huerfano = fs.readdirSync(db.UPLOADS_DIR).find(n => !antesDeFallar.has(n));
    assert.ok(huerfano);
    assert.equal((await db.obtenerPorRef('ANTES-COMMIT')).evidencia_fotos.length, 0);
    assert.equal((await db.pool.query("SELECT * FROM evidencia_operaciones WHERE ref='ANTES-COMMIT'")).rowCount, 0);
    await conFalloCommit(true, async () => {
      assert.equal((await enviar('DESPUES-COMMIT', randomUUID())).status, 500);
    });
    const confirmada = (await db.obtenerPorRef('DESPUES-COMMIT')).evidencia_fotos[0];
    assert.ok(fs.existsSync(path.join(db.UPLOADS_DIR, confirmada)));
    assert.equal((await db.pool.query("SELECT * FROM evidencia_operaciones WHERE ref='DESPUES-COMMIT'")).rowCount, 1);
    const futuro = Date.now() + 25 * 3600000;
    const crearArchivo = (i, nombre) => {
      nombre ||= `${Date.now()}-${i.toString(16).padStart(12, '0')}.png`;
      fs.writeFileSync(path.join(db.UPLOADS_DIR, nombre), 'sintético');
      return nombre;
    };
    const objetivo = crearArchivo(1), comprobante = crearArchivo(2), operacionSola = crearArchivo(3);
    await db.actualizarPorRef('ANTES-COMMIT', { objetivo_foto: objetivo, comprobante });
    await db.eliminarPorRef('ANTES-COMMIT'); // También referencias en papelera.
    await db.pool.query(`UPDATE evidencia_operaciones SET fotos = fotos || $1::jsonb
      WHERE ref='DESPUES-COMMIT'`, [JSON.stringify([operacionSola])]);
    const reciente = crearArchivo(4, `${futuro}-000000000004.webp`);
    const ajeno = crearArchivo(5, 'respaldo.txt');
    const enlace = `${Date.now()}-000000000006.png`;
    fs.symlinkSync(path.join(db.UPLOADS_DIR, huerfano), path.join(db.UPLOADS_DIR, enlace));
    const carpeta = `${Date.now()}-000000000007.png`;
    fs.mkdirSync(path.join(db.UPLOADS_DIR, carpeta));
    assert.equal((await db.limpiarUploadsHuerfanos({ simular: false })).eliminados, 0,
      'La gracia real impide borrar los archivos recién subidos');
    const simulacion = await db.limpiarUploadsHuerfanos({ ahora: futuro });
    assert.equal(simulacion.candidatos, 1);
    assert.equal(simulacion.eliminados, 0);
    assert.ok(fs.existsSync(path.join(db.UPLOADS_DIR, huerfano)));
    // Otra instancia mantiene un lock compartido; no depende de memoria local.
    const instancia = await conectar();
    try {
      await instancia.query('SELECT pg_advisory_lock_shared($1)', [427100123]);
      assert.ok((await db.limpiarUploadsHuerfanos({ simular: false, ahora: futuro })).omitida);
    } finally {
      await instancia.query('SELECT pg_advisory_unlock_shared($1)', [427100123]);
      instancia.release();
    }
    const escritura = await conectar();
    try {
      await escritura.query('BEGIN');
      await escritura.query("UPDATE agendamientos SET data=data || '{\"pendiente\":true}' WHERE ref='ANTES-COMMIT'");
      await assert.rejects(db.limpiarUploadsHuerfanos({ simular: false, ahora: futuro }), /lock timeout/);
      assert.ok(fs.existsSync(path.join(db.UPLOADS_DIR, huerfano)),
        'No borrar mientras el resultado de una escritura SQL siga pendiente');
    } finally {
      await escritura.query('ROLLBACK');
      escritura.release();
    }
    // Si falla la consulta de referencias/operaciones, no tocar el directorio.
    await db.pool.query('ALTER TABLE evidencia_operaciones RENAME TO operaciones_no_disponibles');
    try {
      await assert.rejects(db.limpiarUploadsHuerfanos({ simular: false, ahora: futuro }), /evidencia_operaciones/);
      assert.ok(fs.existsSync(path.join(db.UPLOADS_DIR, huerfano)));
    } finally {
      await db.pool.query('ALTER TABLE operaciones_no_disponibles RENAME TO evidencia_operaciones');
    }
    const limpieza = await db.limpiarUploadsHuerfanos({ simular: false, ahora: futuro });
    assert.equal(limpieza.eliminados, 1);
    assert.equal(limpieza.errores, 0);
    assert.equal(fs.existsSync(path.join(db.UPLOADS_DIR, huerfano)), false);
    for (const n of [confirmada, objetivo, comprobante, operacionSola, reciente, ajeno, carpeta]) {
      assert.ok(fs.existsSync(path.join(db.UPLOADS_DIR, n)), 'Conserva ' + n);
    }
    assert.ok(fs.lstatSync(path.join(db.UPLOADS_DIR, enlace)).isSymbolicLink());
    assert.equal((await db.limpiarUploadsHuerfanos({ simular: false, ahora: futuro })).eliminados, 0,
      'Repetir la limpieza es idempotente');
    await assert.rejects(db.limpiarUploadsHuerfanos({ graciaMs: 0 }), /24 horas/);
    // Mantener abierto un multipart real: el bloqueo debe empezar antes de que
    // multer termine, no solo durante guardarEvidencia.
    const http = require('node:http');
    const boundary = 'limpieza-aislada';
    const peticion = http.request(base + '/admin/evidencia/ROLLBACK', {
      method: 'POST', headers: { Origin: base, Cookie: cookie, Accept: 'application/json',
        'Content-Type': 'multipart/form-data; boundary=' + boundary },
    });
    const respuesta = new Promise((resolve, reject) => {
      peticion.on('error', reject);
      peticion.on('response', res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    });
    const cantidadAntes = cantidad();
    peticion.write(`--${boundary}\r\nContent-Disposition: form-data; name="operacion"\r\n\r\n${randomUUID()}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="fotos"; filename="activa.png"\r\nContent-Type: image/png\r\n\r\nimagen parcial`);
    try {
      const limite = Date.now() + 3000;
      while (cantidad() === cantidadAntes && Date.now() < limite) await new Promise(r => setTimeout(r, 10));
      assert.equal(cantidad(), cantidadAntes + 1);
      assert.ok((await db.limpiarUploadsHuerfanos({ simular: false, ahora: futuro })).omitida);
    } finally { peticion.end(`\r\n--${boundary}--\r\n`); }
    assert.equal(await respuesta, 200);
  } finally {
    if (servidor) {
      servidor.closeAllConnections();
      await new Promise(r => servidor.close(r));
    }
    if (db) await db.cerrar();
    if (started) ejecutar('pg_ctl', ['-D', pgdir, '-m', 'immediate', '-w', 'stop']);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
