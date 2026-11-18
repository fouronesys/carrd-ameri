'use strict';

// Aplicación y PostgreSQL desechables; nunca conecta a las credenciales del proyecto.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { parseHTML } = require('linkedom');

test('Compatibilidad de adelantos extra distingue otros extras y no crea plazos de entrega', () => {
  const { esAdelantoIndependiente } = require('../lib/adelanto-independiente');
  const { plazoEntrega } = require('../lib/seguimientos');
  const legado = { adelanto: 'extra', producto: ' Adelanto (urgencia) ', estado: 'agendado', creado_en: '2026-01-01' };
  assert.equal(esAdelantoIndependiente(legado), true);
  assert.equal(plazoEntrega(legado), null);
  for (const r of [
    { adelanto: 'extra', producto: 'Velación nocturna' },
    { adelanto: 'extra', producto: 'Ocultamiento' },
    { adelanto: 'incluido', producto: 'Trabajo' },
    { producto: 'Adelanto (urgencia)' },
  ]) assert.equal(esAdelantoIndependiente(r), false);
});

test('Adelantos: asignación, cambio, desvinculación, permisos, concurrencia y agenda real', { timeout: 60000 }, async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adelantos-'));
  const pgdir = path.join(tmp, 'pg');
  const env = { PATH: process.env.PATH, HOME: tmp, LANG: 'C.UTF-8' };
  const ejecutar = (cmd, args) => {
    const r = spawnSync(cmd, args, { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr || r.stdout);
  };
  const socket = net.createServer().listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(r => socket.close(r));
  let db, server, iniciado = false;
  try {
    ejecutar('initdb', ['-D', pgdir, '-A', 'trust', '-U', 'test', '--no-locale']);
    ejecutar('pg_ctl', ['-D', pgdir, '-l', path.join(tmp, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -k ${tmp}`, '-w', 'start']);
    iniciado = true;
    Object.assign(process.env, {
      POSTGRES_URL: `postgresql://test@127.0.0.1:${port}/postgres`, DATABASE_URL: '', PGSSL: 'false',
      DATA_DIR: path.join(tmp, 'data'), ADMIN_PASSWORD: 'admin-aislado', ASSISTANT_PASSWORD: 'asistente-aislado',
      SESSION_SECRET: 'sesion-aislada', NODE_ENV: 'test',
    });
    db = require('../lib/db');
    await db.init();
    await db.init();
    const session = require('express-session');
    for (const [mod, exports] of [
      ['connect-pg-simple', () => session.MemoryStore],
      ['../lib/mailer', { enviarAlertaLogin: async () => ({ enviado: false }) }],
    ]) {
      const id = require.resolve(mod);
      require.cache[id] = { id, filename: id, loaded: true, exports };
    }
    const { app } = require('../server');
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = 'http://127.0.0.1:' + server.address().port;
    const request = (ruta, cookie, body, origin = url) => fetch(url + ruta, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'manual',
      headers: { cookie: cookie || '', Origin: origin },
      ...(body === undefined ? {} : { body: new URLSearchParams(body) }),
    });
    const login = async password => {
      const res = await request('/admin/login', '', { password });
      assert.equal(res.status, 302);
      return res.headers.get('set-cookie').split(';')[0];
    };
    const admin = await login('admin-aislado');
    const assistant = await login('asistente-aislado');
    assert.equal((await request('/admin/usuarios', admin, {
      usuario: 'operador', nombre: 'Operador de prueba', rol: 'admin', password: 'operador-aislado',
    })).status, 200);
    const namedLogin = await request('/admin/login', '', { usuario: 'operador', password: 'operador-aislado' });
    assert.equal(namedLogin.status, 302);
    const namedAdmin = namedLogin.headers.get('set-cookie').split(';')[0];
    const operador = await db.obtenerUsuarioAdmin('operador');
    const actor = { usuario: 'prueba', usuario_id: 'fixture', rol: 'admin', password: 'no-guardar', cookie: 'no-guardar' };
    const vincular = (ref, servicio, anterior) => db.vincularAdelanto(ref, servicio, anterior, actor);
    const base = { estado: 'agendado', cliente_id: 'COMPRADOR', cliente_nombre: 'Comprador de prueba',
      precio_cop: 30000, pedido_total_cop: 65432, metodo: 'wompi', pagado_en: '2026-11-01' };
    const datos = [
      { ref: 'A', adelanto: 'solo', pedido_ref: 'P-A' },
      { ref: 'B', adelanto: 'solo' },
      { ref: 'S1', producto: 'Servicio primero', pedido_ref: 'P-S1' },
      { ref: 'S2', producto: 'Lectura <segura>', tipo_servicio: 'lectura', pedido_ref: 'P-S2' },
      { ref: 'AJENO', cliente_id: 'OTRO' },
      { ref: 'INCLUIDO', adelanto: 'incluido' },
      { ref: 'PENDIENTE', estado: 'pendiente_pago' },
      { ref: 'RECHAZADO', estado: 'rechazado' },
      { ref: 'VERIFICACION', estado: 'pendiente_verificacion' },
      { ref: 'HECHO', trabajo_hecho: true },
      { ref: 'ELIMINADO', eliminado_en: '2026-01-01' },
      { ref: 'INV-A', cliente_id: '', pedido_ref: 'INV', adelanto: 'solo' },
      { ref: 'INV-S', cliente_id: '', pedido_ref: 'INV' },
      { ref: 'INV-OTRO', cliente_id: '', pedido_ref: 'OTRO', cliente_nombre: 'Comprador de prueba' },
      { ref: 'SIN-ID-A', cliente_id: '', adelanto: 'solo' },
      { ref: 'SIN-ID-S', cliente_id: '' },
    ].map(r => ({ ...base, ...r }));
    for (const r of datos) await db.crearAgendamiento(r);
    const originales = await db.pool.query('SELECT ref,data FROM agendamientos ORDER BY ref');
    const guardar = (servicio_ref, anterior = '', cookie = admin) =>
      request('/admin/adelanto/A', cookie, { servicio_ref, anterior });

    await t.test('Valida identidad, pago, actividad y permisos sin cambiar nada', async () => {
      assert.equal((await request('/admin/adelanto/A')).status, 302);
      assert.equal((await request('/admin/adelanto/A', assistant)).status, 403);
      assert.equal((await guardar('S1', '', assistant)).status, 403);
      assert.equal((await request('/admin/adelanto/A', '', { servicio_ref: 'S1', anterior: '' })).status, 302);
      assert.equal((await request('/admin/adelanto/A', admin, { servicio_ref: 'S1', anterior: '' }, 'https://otro.invalid')).status, 403);
      assert.equal((await request('/admin/adelanto/A', admin, { servicio_ref: 'S1' })).status, 400);
      for (const ref of ['AJENO', 'A', 'B', 'INCLUIDO', 'PENDIENTE', 'RECHAZADO', 'VERIFICACION', 'HECHO', 'ELIMINADO', 'NO-EXISTE']) {
        assert.equal((await guardar(ref)).status, 400, ref);
      }
      for (const estado of ['pendiente_pago', 'rechazado', 'pendiente_verificacion']) {
        await db.actualizarPorRef('A', { estado });
        assert.equal((await guardar('S1')).status, 400);
      }
      await db.actualizarPorRef('A', { estado: 'agendado' });
      for (const cambios of [{ trabajo_hecho: true }, { eliminado_en: '2026-01-01' }]) {
        await db.actualizarPorRef('A', cambios);
        assert.equal((await guardar('S1')).status, 400);
        await db.actualizarPorRef('A', { trabajo_hecho: false, eliminado_en: null });
      }
      await assert.rejects(vincular('INV-A', 'INV-OTRO', ''), /mismo comprador/);
      await assert.rejects(vincular('SIN-ID-A', 'SIN-ID-S', ''), /mismo comprador/);
      await assert.rejects(db.vincularAdelanto('A', 'S1', ''), { status: 403 });
      await assert.rejects(db.vincularAdelanto('A', 'S1', '', { usuario: 'asistente', rol: 'asistente' }), { status: 403 });
      await vincular('INV-A', 'INV-S', '');
      await vincular('INV-A', '', 'INV-S');
      assert.equal(await db.obtenerVinculoAdelanto('A'), '');
      assert.equal((await db.obtenerPorRef('A')).adelanto_historial, undefined);
    });

    await t.test('Formulario real, asignación, cambio entre tipos y desvinculación', async () => {
      let res = await request('/admin/adelanto/A', admin);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      let d = parseHTML(await res.text()).document;
      assert.deepEqual([...d.querySelectorAll('option')].map(o => o.value).sort(), ['', 'S1', 'S2']);
      assert.equal(d.querySelector('form').getAttribute('action'), '/admin/adelanto/A');
      assert.equal(d.querySelector('input[name=anterior]').value, '');
      assert.match(d.querySelector('select').textContent, /Lectura <segura>/);
      assert.equal(d.querySelectorAll('segura').length, 0);
      const vistaLector = await db.listarAgendaPanel({ tipo: 'trabajo', sesion: 'otro-administrador' });
      assert.equal(vistaLector.cambios, false);
      assert.match(d.body.textContent, /No hay cambios de vinculación registrados/);
      res = await guardar('S1');
      assert.equal(res.status, 302);
      assert.deepEqual(await db.listarAgendaPanel({
        tipo: 'trabajo', sesion: 'otro-administrador', vista: vistaLector.vista, comprobar: true,
      }), { cambios: true, caducada: false }, 'Vincular un adelanto desde otro administrador también activa el aviso');
      assert.equal(await db.obtenerVinculoAdelanto('A'), 'S1');
      let agenda = await db.listarAgendaPanel({ buscar: 'A' });
      assert.equal(agenda.registros.find(r => r.ref === 'S1').adelanto_vinculado_activo, true);
      assert.equal(agenda.registros.find(r => r.ref === 'A').adelanto_servicio_ref, 'S1');
      let html = await (await request(res.headers.get('location'), admin)).text();
      d = parseHTML(html).document;
      assert.match(d.querySelector('[data-ref=S1]').textContent, /Adelanto vinculado: A · entrega prioritaria/);
      assert.match(d.querySelector('[data-ref=A]').textContent, /servicio: S1/);
      res = await request('/admin/adelanto/A', admin);
      d = parseHTML(await res.text()).document;
      assert.equal(d.querySelector('input[name=anterior]').value, 'S1');
      assert.ok(d.querySelector('option[value=S1]').hasAttribute('selected'));
      const cambio = await request('/admin/adelanto/A', namedAdmin, {
        servicio_ref: 'S2', anterior: 'S1', usuario: 'falsificado', usuario_id: 'falso',
        actor: 'falsificado', fecha: '1900-01-01', password: 'no-guardar',
      });
      assert.equal(cambio.status, 302);
      assert.equal((await guardar('S1', 'S1')).status, 409, 'No sobrescribe un formulario obsoleto');
      agenda = await db.listarAgendaPanel({ tipo: 'lectura', buscar: 'urgencia' });
      assert.deepEqual(agenda.registros.map(r => r.ref), ['S2'], 'Búsqueda funciona aunque el adelanto sea de otro tipo');
      assert.equal(agenda.registros[0].adelanto_vinculado_activo, true);
      assert.equal((await guardar('', 'S2')).status, 302);
      assert.equal(await db.obtenerVinculoAdelanto('A'), '');
      assert.equal((await db.listarAgendaPanel({ tipo: 'lectura', buscar: 'urgencia' })).personas, 0);
      const historial = (await db.obtenerPorRef('A')).adelanto_historial;
      assert.deepEqual(historial.map(h => h.accion), ['asignacion', 'cambio', 'desvinculacion']);
      assert.deepEqual(historial.map(h => [h.anterior?.ref || null, h.nuevo?.ref || null]),
        [[null, 'S1'], ['S1', 'S2'], ['S2', null]]);
      assert.deepEqual(historial[0].actor, { usuario: 'administrador', usuario_id: '', rol: 'admin' });
      assert.deepEqual(historial[1].actor, { usuario: 'operador', usuario_id: operador.id, rol: 'admin' });
      assert.ok(historial.every(h => Number.isFinite(Date.parse(h.fecha)) && h.fecha.startsWith(new Date().toISOString().slice(0, 10))));
      assert.doesNotMatch(JSON.stringify(historial), /falsificado|no-guardar|password|cookie|precio_cop|SESSION_SECRET/);
      assert.equal((await guardar('')).status, 302, 'Reenviar sin cambios es inocuo');
      assert.deepEqual((await db.obtenerPorRef('A')).adelanto_historial, historial);
      await db.actualizarPorRef('S2', { producto: 'Renombrado después' });
      d = parseHTML(await (await request('/admin/adelanto/A', admin)).text()).document;
      const entradas = [...d.querySelectorAll('.historial li')];
      assert.equal(entradas.length, 3);
      assert.match(entradas[0].textContent, /Desvinculación.*S2/s);
      assert.match(entradas[0].textContent, /Lectura <segura>/);
      assert.doesNotMatch(d.querySelector('.historial').textContent, /Renombrado después/);
      assert.match(entradas[1].textContent, /operador/);
      assert.equal(d.querySelectorAll('segura').length, 0);
      await db.actualizarPorRef('S2', { producto: 'Lectura <segura>' });
    });

    await t.test('Auditoría y asociación se revierten juntas si falla la escritura o el commit', async () => {
      const original = await db.obtenerPorRef('A');
      await db.pool.query(`CREATE FUNCTION rechazar_auditoria_adelanto() RETURNS trigger LANGUAGE plpgsql AS
        $$ BEGIN RAISE EXCEPTION 'fallo de auditoria simulado'; END $$;
        CREATE TRIGGER fallo_auditoria_adelanto BEFORE UPDATE ON agendamientos
        FOR EACH ROW WHEN (NEW.data->'adelanto_historial' IS DISTINCT FROM OLD.data->'adelanto_historial')
        EXECUTE FUNCTION rechazar_auditoria_adelanto()`);
      try {
        await assert.rejects(vincular('A', 'S1', ''), /fallo de auditoria simulado/);
        assert.deepEqual(await db.obtenerPorRef('A'), original);
      } finally {
        await db.pool.query('DROP TRIGGER fallo_auditoria_adelanto ON agendamientos');
      }
      await db.pool.query(`CREATE CONSTRAINT TRIGGER fallo_commit_adelanto AFTER UPDATE ON agendamientos
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
        EXECUTE FUNCTION rechazar_auditoria_adelanto()`);
      try {
        await assert.rejects(vincular('A', 'S1', ''), /fallo de auditoria simulado/);
        assert.deepEqual(await db.obtenerPorRef('A'), original);
      } finally {
        await db.pool.query('DROP TRIGGER fallo_commit_adelanto ON agendamientos; DROP FUNCTION rechazar_auditoria_adelanto()');
      }
    });

    await t.test('Asociación única incluso con dos asignaciones simultáneas', async () => {
      const contar = async () => {
        const registros = await Promise.all(['A', 'B'].map(ref => db.obtenerPorRef(ref)));
        return registros.reduce((n, r) => n + (r.adelanto_historial || []).length, 0);
      };
      const antes = await contar();
      const resultados = await Promise.allSettled([vincular('A', 'S1', ''), vincular('B', 'S1', '')]);
      assert.equal(resultados.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal(await contar(), antes + 1, 'Solo el ganador registra auditoría');
      assert.equal(resultados.find(r => r.status === 'rejected').reason.status, 409);
      const ganador = (await db.obtenerVinculoAdelanto('A')) ? 'A' : 'B';
      const perdedor = ganador === 'A' ? 'B' : 'A';
      assert.ok(!(await db.candidatosAdelanto(perdedor)).some(r => r.ref === 'S1'));
      await vincular(perdedor, 'S2', '');
      const previo = await db.obtenerPorRef(perdedor);
      await assert.rejects(vincular(perdedor, 'S1', 'S2'), { status: 409 });
      assert.deepEqual(await db.obtenerPorRef(perdedor), previo);
      assert.equal(await db.obtenerVinculoAdelanto(perdedor), 'S2', 'El conflicto no pierde la asociación anterior');
      await vincular(ganador, '', 'S1');
      await vincular(perdedor, '', 'S2');
      // Preview comparte base pero no migra: no depende de un índice nuevo.
      await db.pool.query('DROP INDEX agendamientos_adelanto_servicio_idx');
      const sinIndice = await Promise.allSettled([vincular('A', 'S1', ''), vincular('B', 'S1', '')]);
      assert.equal(sinIndice.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal(sinIndice.find(r => r.status === 'rejected').reason.status, 409);
      const unico = (await db.obtenerVinculoAdelanto('A')) ? 'A' : 'B';
      await vincular(unico, '', 'S1');
      await db.init();
    });

    await t.test('Pago, entrega, borrado y restauración recalculan prioridad sin duplicados', async () => {
      await vincular('A', 'S1', '');
      const prioridad = async () => (await db.listarAgendaPanel({ buscar: 'S1' })).registros.find(r => r.ref === 'S1');
      const { esAdelantoPrioritario } = require('../lib/agenda-panel');
      assert.ok(esAdelantoPrioritario(await prioridad()));
      const resumen = await db.resumenPanel();
      for (const ref of ['A', 'S1']) {
        await db.actualizarPorRef(ref, { estado: 'rechazado' });
        assert.equal(esAdelantoPrioritario(await prioridad()), false);
        await db.actualizarPorRef(ref, { estado: 'agendado' });
        await db.actualizarPorRef(ref, { trabajo_hecho: true });
        assert.equal(esAdelantoPrioritario((await prioridad()) || {}), false);
        await db.actualizarPorRef(ref, { trabajo_hecho: false });
        await db.eliminarPorRef(ref);
        assert.equal(esAdelantoPrioritario((await prioridad()) || {}), false);
        await db.restaurarPorRef(ref);
        assert.ok(esAdelantoPrioritario(await prioridad()));
      }
      assert.deepEqual(await db.resumenPanel(), resumen);
      // No se alteran pagos, precios, identidad ni se crean servicios.
      const actuales = await db.pool.query('SELECT ref,data FROM agendamientos ORDER BY ref');
      for (let i = 0; i < originales.rows.length; i++) {
        const limpiar = r => {
          const { trabajo_hecho, trabajo_hecho_en, eliminado_en, adelanto_servicio_ref, adelanto_historial, ...resto } = r.data;
          return { ref: r.ref, data: resto };
        };
        assert.deepEqual(limpiar(actuales.rows[i]), limpiar(originales.rows[i]));
      }
      await vincular('A', '', 'S1');
      // El nuevo comprador urgente debe entrar antes de paginar.
      await db.actualizarPorRef('INCLUIDO', { estado: 'rechazado' });
      for (let i = 0; i < 18; i++) await db.crearAgendamiento({
        ref: 'NORMAL-' + i, cliente_id: 'NORMAL-' + i, estado: 'agendado', pagado_en: '2020-01-01',
      });
      const sesion = 'recorrido-adelantos-aislado';
      const recorrido = await db.listarAgendaPanel({ sesion });
      assert.ok(!recorrido.registros.some(r => r.cliente_id === 'COMPRADOR'));
      await vincular('A', 'S2', '');
      const conservada = await db.listarAgendaPanel({ sesion, vista: recorrido.vista });
      assert.deepEqual(conservada.registros.map(r => r.ref), recorrido.registros.map(r => r.ref),
        'Vincular no mueve compradores entre páginas de un recorrido abierto');
      const segundaConservada = await db.listarAgendaPanel({ sesion, vista: recorrido.vista, pagina: 2 });
      assert.equal(segundaConservada.registros.find(r => r.ref === 'S2').adelanto_vinculado_activo, true,
        'El recorrido estable conserva el orden, pero muestra la vinculación actual');
      const pag1 = await db.listarAgendaPanel();
      assert.equal(pag1.registros[0].ref, 'S2');
      const pag2 = await db.listarAgendaPanel({ pagina: 2 });
      const refs = [...pag1.registros, ...pag2.registros].map(r => r.ref);
      assert.equal(new Set(refs).size, refs.length);
      assert.equal(refs.length, (await db.listarAgendamientos()).length);
      await db.eliminarDefinitivamentePorRef('S2');
      assert.equal(await db.obtenerVinculoAdelanto('A'), '', 'Eliminar definitivamente libera la asociación');
    });
    await t.test('Adelantos antiguos extra: filtro, zona, contadores y vinculación sin reescribir pagos', async () => {
      // Aislado: reproduce ambos pedidos aportados sin datos de clientes reales.
      await db.pool.query('DELETE FROM agendamientos');
      const registros = [
        { ref: 'LEGADO-1', pedido_ref: 'LEGADO-P1', adelanto: 'extra', producto: 'Adelanto (urgencia)' },
        { ref: 'LEGADO-2', pedido_ref: 'LEGADO-P2', adelanto: 'extra', producto: 'Adelanto (urgencia)' },
        { ref: 'SERVICIO-LEGADO', pedido_ref: 'LEGADO-P1', producto: 'Trabajo real' },
        { ref: 'OTRO-EXTRA', pedido_ref: 'LEGADO-P1', adelanto: 'extra', producto: 'Velación nocturna' },
        { ref: 'LEGADO-PENDIENTE', pedido_ref: 'LEGADO-P3', adelanto: 'extra', producto: 'Adelanto (urgencia)', estado: 'pendiente_pago' },
      ].map(r => ({ estado: 'agendado', precio_cop: 28000, tipo_servicio: 'trabajo', ...r }));
      for (const r of registros) await db.crearAgendamiento(r);
      const resumen = await db.resumenPanel();
      assert.equal(resumen.agendados, 2, 'Los recargos no suman trabajos');
      assert.equal(resumen.personas_agendadas, 1, 'El pedido de solo recargo no suma una persona');
      const filtro = await db.listarAgendaPanel({ adelanto: 'si', buscar: 'adelantos' });
      assert.deepEqual(filtro.registros.map(r => r.ref).sort(), ['LEGADO-1', 'LEGADO-2']);
      assert.ok(filtro.registros.every(r => !r.adelanto_vinculado_activo));
      const html = await request('/admin?adelanto=si&buscar=adelantos', admin);
      const d = parseHTML(await html.text()).document;
      for (const ref of ['LEGADO-1', 'LEGADO-2']) {
        const fila = d.querySelector('[data-ref="' + ref + '"]');
        assert.ok(fila);
        assert.match(fila.textContent, /sin servicio asociado/);
        assert.ok(fila.querySelector('a[href="/admin/adelanto/' + ref + '"]'));
        assert.equal(fila.querySelector('.trabajo-form'), null);
        assert.equal((await request('/admin/adelanto/' + ref, admin)).status, 200);
        const intento = await request('/admin/trabajo/' + ref, admin, { accion: 'marcar' });
        assert.equal(intento.status, 400);
      }
      assert.ok((await db.candidatosAdelanto('LEGADO-1')).some(r => r.ref === 'SERVICIO-LEGADO'));
      assert.ok(!(await db.candidatosAdelanto('LEGADO-1')).some(r => r.ref === 'LEGADO-2'));
      await db.vincularAdelanto('LEGADO-1', 'SERVICIO-LEGADO', '', actor);
      const vinculado = await db.obtenerParaSeguimiento('SERVICIO-LEGADO');
      assert.equal(vinculado.adelanto_vinculado_activo, true);
      assert.equal((await db.obtenerPorRef('LEGADO-1')).adelanto, 'extra', 'No se migra el pago histórico');
      const nuevoFiltro = await db.listarAgendaPanel({ adelanto: 'si' });
      assert.ok(nuevoFiltro.registros.some(r => r.ref === 'SERVICIO-LEGADO'));
      assert.ok(!nuevoFiltro.registros.some(r => r.ref === 'OTRO-EXTRA'));
    });
  } finally {
    if (server) await new Promise(r => server.close(r));
    if (db) await db.cerrar();
    if (iniciado) ejecutar('pg_ctl', ['-D', pgdir, '-m', 'immediate', '-w', 'stop']);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
