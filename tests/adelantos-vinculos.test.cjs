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
      await assert.rejects(db.vincularAdelanto('INV-A', 'INV-OTRO', ''), /mismo comprador/);
      await assert.rejects(db.vincularAdelanto('SIN-ID-A', 'SIN-ID-S', ''), /mismo comprador/);
      await db.vincularAdelanto('INV-A', 'INV-S', '');
      await db.vincularAdelanto('INV-A', '', 'INV-S');
      assert.equal(await db.obtenerVinculoAdelanto('A'), '');
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
      res = await guardar('S1');
      assert.equal(res.status, 302);
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
      assert.equal((await guardar('S2', 'S1')).status, 302);
      assert.equal((await guardar('S1', 'S1')).status, 409, 'No sobrescribe un formulario obsoleto');
      agenda = await db.listarAgendaPanel({ tipo: 'lectura', buscar: 'urgencia' });
      assert.deepEqual(agenda.registros.map(r => r.ref), ['S2'], 'Búsqueda funciona aunque el adelanto sea de otro tipo');
      assert.equal(agenda.registros[0].adelanto_vinculado_activo, true);
      assert.equal((await guardar('', 'S2')).status, 302);
      assert.equal(await db.obtenerVinculoAdelanto('A'), '');
      assert.equal((await db.listarAgendaPanel({ tipo: 'lectura', buscar: 'urgencia' })).personas, 0);
    });

    await t.test('Asociación única incluso con dos asignaciones simultáneas', async () => {
      const resultados = await Promise.allSettled([db.vincularAdelanto('A', 'S1', ''), db.vincularAdelanto('B', 'S1', '')]);
      assert.equal(resultados.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal(resultados.find(r => r.status === 'rejected').reason.status, 409);
      const ganador = (await db.obtenerVinculoAdelanto('A')) ? 'A' : 'B';
      const perdedor = ganador === 'A' ? 'B' : 'A';
      assert.ok(!(await db.candidatosAdelanto(perdedor)).some(r => r.ref === 'S1'));
      await db.vincularAdelanto(perdedor, 'S2', '');
      await assert.rejects(db.vincularAdelanto(perdedor, 'S1', 'S2'), { status: 409 });
      assert.equal(await db.obtenerVinculoAdelanto(perdedor), 'S2', 'El conflicto no pierde la asociación anterior');
      await db.vincularAdelanto(ganador, '', 'S1');
      await db.vincularAdelanto(perdedor, '', 'S2');
      // Preview comparte base pero no migra: no depende de un índice nuevo.
      await db.pool.query('DROP INDEX agendamientos_adelanto_servicio_idx');
      const sinIndice = await Promise.allSettled([db.vincularAdelanto('A', 'S1', ''), db.vincularAdelanto('B', 'S1', '')]);
      assert.equal(sinIndice.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal(sinIndice.find(r => r.status === 'rejected').reason.status, 409);
      const unico = (await db.obtenerVinculoAdelanto('A')) ? 'A' : 'B';
      await db.vincularAdelanto(unico, '', 'S1');
      await db.init();
    });

    await t.test('Pago, entrega, borrado y restauración recalculan prioridad sin duplicados', async () => {
      await db.vincularAdelanto('A', 'S1', '');
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
          const { trabajo_hecho, trabajo_hecho_en, eliminado_en, adelanto_servicio_ref, ...resto } = r.data;
          return { ref: r.ref, data: resto };
        };
        assert.deepEqual(limpiar(actuales.rows[i]), limpiar(originales.rows[i]));
      }
      await db.vincularAdelanto('A', '', 'S1');
      // El nuevo comprador urgente debe entrar antes de paginar.
      await db.actualizarPorRef('INCLUIDO', { estado: 'rechazado' });
      for (let i = 0; i < 18; i++) await db.crearAgendamiento({
        ref: 'NORMAL-' + i, cliente_id: 'NORMAL-' + i, estado: 'agendado', pagado_en: '2020-01-01',
      });
      const sesion = 'recorrido-adelantos-aislado';
      const recorrido = await db.listarAgendaPanel({ sesion });
      assert.ok(!recorrido.registros.some(r => r.cliente_id === 'COMPRADOR'));
      await db.vincularAdelanto('A', 'S2', '');
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
  } finally {
    if (server) await new Promise(r => server.close(r));
    if (db) await db.cerrar();
    if (iniciado) ejecutar('pg_ctl', ['-D', pgdir, '-m', 'immediate', '-w', 'stop']);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
