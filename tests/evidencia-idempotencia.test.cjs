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
        return { messageId: 'synthetic-message' };
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
    async function login(password) {
      const r = await fetch(base + '/admin/login', {
        method: 'POST', redirect: 'manual', headers: { Origin: base },
        body: new URLSearchParams({ password }),
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
      assert.deepEqual(Object.keys(op).sort(), ['correo', 'creado_en', 'ref']);
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
      assert.equal(panel.querySelector('form, img, input[type=file]'), null);
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
    await db.pool.query('UPDATE evidencia_operaciones SET correo = $1', ['enviado']);
    const vacia = seccion(await (await fetch(base + consulta, { headers: { Cookie: cookie } })).text());
    assert.match(vacia.textContent, /No hay operaciones/);
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
