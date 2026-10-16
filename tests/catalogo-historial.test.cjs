'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { evento, filtros } = require('../lib/catalogo-historial');

test('Auditoría usa lista permitida y no serializa sesión, claves ni contraseñas', () => {
  const e = evento('creacion', null,
    { id: 'seguro', nombre: '<script>nombre</script>', password: 'no-guardar', hash: 'no-guardar', secreto: 'no-guardar' },
    { rol: 'admin', usuario: 'operador', usuario_id: 'u1', password: 'no-guardar', cookie: 'no-guardar' });
  assert.equal(JSON.stringify(e).includes('no-guardar'), false);
  assert.equal(e.usuario_id, 'u1');
  assert.deepEqual(e.nuevo, { id: 'seguro', nombre: '<script>nombre</script>' });
  assert.throws(() => evento('creacion', null, { id: '1' }, { rol: 'asistente', usuario: 'a' }));
  assert.throws(() => evento('creacion', null, { id: '1' }, { rol: 'admin', usuario: '' }));
  assert.deepEqual(filtros({ h_desde: '2026-02-30', h_hasta: 'no', h_accion: 'otro', h_pagina: '-1', h_buscar: ['x'] }),
    { buscar: '', accion: '', desde: '', hasta: '', pagina: 1 });
});

let server, url, cookie, fixture;
before(async () => {
  Object.assign(process.env, {
    ADMIN_PASSWORD: 'isolated-admin-test', ASSISTANT_PASSWORD: 'isolated-assistant-test',
    SESSION_SECRET: 'isolated-session-test-not-a-live-secret', NODE_ENV: 'test',
  });
  fixture = require('./helpers/admin-fixture.cjs');
  server = fixture.app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  url = 'http://127.0.0.1:' + server.address().port;
  cookie = await login('isolated-admin-test');
});
after(async () => { if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); } });
async function login(password) {
  const r = await fetch(url + '/admin/login', { method: 'POST', redirect: 'manual', headers: { Origin: url }, body: new URLSearchParams({ password }) });
  return r.headers.get('set-cookie').split(';')[0];
}
async function request(path, data, session = cookie) {
  return fetch(url + path, {
    method: data ? 'POST' : 'GET', redirect: 'manual',
    headers: { Origin: url, Cookie: session, Accept: 'application/json' },
    body: data ? new URLSearchParams(data) : undefined,
  });
}

test('Todas las mutaciones se atribuyen a la sesión y el historial sobrevive a eliminar', async () => {
  const values = { tipo: 'lectura', nombre: 'Lectura inicial', descripcion: 'Descripción', seccion: 'Preguntas', precio_cop: '45000', precio_usd: '12', orden: '1', usuario: 'falsificado', password: 'no-guardar' };
  assert.equal((await request('/admin/catalogo', { ...values, precio_cop: '0' })).status, 400);
  assert.equal(fixture.historial.length, 0);
  assert.equal((await request('/admin/catalogo', values)).status, 200);
  const id = [...fixture.servicios.keys()][0];
  const path = '/admin/catalogo/' + id;
  await request(path, { ...values, nombre: 'Lectura <especial>', precio_cop: '60000' });
  await request(path + '/estado', {});
  await request(path + '/estado', {});
  await request(path + '/eliminar', {});
  assert.equal((await request(path + '/eliminar', {})).status, 404);
  assert.equal((await request(path, values)).status, 404);
  const events = fixture.historial;
  assert.deepEqual(events.map(e => e.accion), ['creacion', 'edicion', 'desactivacion', 'activacion', 'eliminacion']);
  assert.ok(events.every(e => e.usuario === 'administrador' && Number.isFinite(Date.parse(e.fecha))));
  assert.equal(events[0].anterior, null);
  assert.equal(events[1].anterior.precio_cop, 45000);
  assert.equal(events[1].nuevo.precio_cop, 60000);
  assert.equal(events[2].nuevo.activo, false);
  assert.equal(events[3].nuevo.activo, true);
  assert.equal(events[4].nuevo, null);
  assert.equal(events[4].anterior.nombre, 'Lectura <especial>');
  assert.equal(JSON.stringify(events).includes('no-guardar'), false);
  const html = await (await request('/admin?tab=catalogo')).text();
  assert.ok(html.includes('Historial de cambios del catálogo'));
  assert.ok(html.includes('Lectura &lt;especial&gt;'));
  assert.ok(html.includes('60000'));
  assert.ok(html.includes('45000'));
  assert.ok(!html.includes('Lectura <especial>'));
});

test('Búsqueda, acción y fechas se aplican en el servidor y muestran un estado vacío', async () => {
  const hoy = new Date().toISOString().slice(0, 10);
  const html = await (await request('/admin?tab=catalogo&h_buscar=ESPECIAL&h_accion=eliminacion&h_desde=' + hoy + '&h_hasta=' + hoy)).text();
  assert.ok(html.includes('Ver valores anteriores y nuevos'));
  assert.equal((html.match(/Ver valores anteriores y nuevos/g) || []).length, 1);
  const empty = await (await request('/admin?tab=catalogo&h_buscar=inexistente')).text();
  assert.ok(empty.includes('No hay cambios para los filtros seleccionados.'));
  const old = await (await request('/admin?tab=catalogo&h_hasta=2000-01-01')).text();
  assert.ok(old.includes('No hay cambios para los filtros seleccionados.'));
});

test('Asistentes y visitantes no pueden leer historial ni ejecutar ninguna mutación', async () => {
  const assistant = await login('isolated-assistant-test');
  const antes = fixture.llamadas.listarHistorialCatalogo || 0;
  for (const session of [assistant, '']) {
    const html = await (await request('/admin?tab=catalogo&h_buscar=administrador', null, session)).text();
    assert.ok(!html.includes('historial-catalogo'));
    for (const path of ['/admin/catalogo', '/admin/catalogo/1', '/admin/catalogo/1/estado', '/admin/catalogo/1/eliminar']) {
      const r = await request(path, {}, session);
      assert.equal(r.status, session ? 403 : 302);
    }
  }
  assert.equal(fixture.llamadas.listarHistorialCatalogo || 0, antes);
  assert.equal(fixture.historial.length, 5);
});
