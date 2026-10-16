'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const catalogo = require('../lib/catalogo');
const base = fs.readFileSync(require.resolve('../index.html'), 'utf8');

test('Counts original services and suggests max order + 1 independently by type', () => {
  const s = catalogo.resumen(base, [
    { tipo: 'hechizo', orden: 800, activo: false }, { tipo: 'lectura', orden: 900 },
  ]);
  assert.ok(s.hechizo.originales > 20);
  assert.ok(s.lectura.originales > 10);
  assert.equal(s.hechizo.total, s.hechizo.originales + 1);
  assert.equal(s.hechizo.siguiente, 801);
  assert.equal(s.lectura.siguiente, 901);
});
test('Inserts into the existing category, respects order, hides inactive services, escapes custom categories', () => {
  const h = catalogo.integrar(base, [
    { id: '1', tipo: 'hechizo', seccion: 'Vinculares', orden: 0, nombre: 'TEST-INSERT' },
    { id: '2', tipo: 'lectura', seccion: 'Autoconocimiento', orden: 999, nombre: 'TEST-LECTURA' },
    { id: '3', tipo: 'hechizo', seccion: 'Vinculares', orden: 0, nombre: 'TEST-HIDDEN', activo: false },
    { id: '4', tipo: 'hechizo', seccion: 'Nueva', orden: 999, nombre: 'TEST-CUSTOM' },
  ], i => '<span class="p">' + i.nombre + '</span>', items => items.map(i => i.nombre).join(''));
  assert.ok(h.indexOf('TEST-INSERT') < h.indexOf('catalogo-dinamico-hechizos'));
  assert.ok(h.indexOf('TEST-LECTURA') < h.indexOf('catalogo-dinamico-lecturas'));
  assert.equal(h.includes('TEST-HIDDEN'), false);
  assert.equal(h.includes('__CATALOGO_'), false);
  assert.ok(h.includes('TEST-CUSTOM'));
  assert.equal((h.match(/class="p"/g) || []).length, (base.match(/class="p"/g) || []).length + 2);
});

let servidor, url, cookie;
before(async () => {
  // Synthetic credentials used only inside this isolated test process.
  process.env.ADMIN_PASSWORD = 'isolated-admin-test';
  process.env.ASSISTANT_PASSWORD = 'isolated-assistant-test';
  process.env.SESSION_SECRET = 'isolated-session-test-not-a-live-secret';
  process.env.NODE_ENV = 'test';
  const fixture = require('./helpers/admin-fixture.cjs');
  servidor = fixture.app.listen(0, '127.0.0.1');
  await new Promise(r => servidor.once('listening', r));
  url = 'http://127.0.0.1:' + servidor.address().port;
  const r = await fetch(url + '/admin/login', {
    method: 'POST', redirect: 'manual', headers: { Origin: url },
    body: new URLSearchParams({ password: 'isolated-admin-test' }),
  });
  assert.equal(r.status, 302);
  cookie = r.headers.get('set-cookie').split(';')[0];
});
after(async () => { if (servidor) { servidor.closeAllConnections(); await new Promise(r => servidor.close(r)); } });
async function peticion(ruta, datos) {
  return fetch(url + ruta, { method: datos ? 'POST' : 'GET', headers: { Cookie: cookie, Origin: url, Accept: 'application/json' },
    body: datos ? new URLSearchParams(datos) : undefined, redirect: 'manual' });
}
test('Catalog tab does not load agenda, delivered jobs, or unrelated administration data', async () => {
  const fixture = require('./helpers/admin-fixture.cjs');
  const antes = { ...fixture.llamadas };
  const r = await peticion('/admin?tab=catalogo');
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes('data-sec="catalogo"'));
  for (const nombre of ['listarAgendaPanel', 'listarRealizados', 'listarUsuariosAdmin', 'listarPromos']) {
    assert.equal(fixture.llamadas[nombre] || 0, antes[nombre] || 0);
  }
  assert.ok(!html.includes('TEST-OLD'));
});
test('Create/edit/hide/publish/delete services, preserve errors and public category placement', async () => {
  const valores = { tipo: 'hechizo', nombre: 'TEST-CATALOG', descripcion: '<script>never()</script>', seccion: 'Vinculares', precio_cop: '25001', precio_usd: '8.25', orden: '0' };
  let r = await peticion('/admin/catalogo', { ...valores, precio_cop: '-1' });
  assert.equal(r.status, 400);
  assert.ok((await r.json()).campos.precio_cop);
  r = await peticion('/admin/catalogo', valores); assert.equal(r.status, 200);
  const fixture = require('./helpers/admin-fixture.cjs');
  const id = [...fixture.servicios.keys()][0];
  let html = await (await fetch(url)).text();
  assert.ok(html.includes('TEST-CATALOG'));
  assert.ok(html.indexOf('TEST-CATALOG') < html.indexOf('catalogo-dinamico-hechizos'));
  assert.ok(html.includes('&lt;script&gt;never()&lt;/script&gt;'));
  assert.equal(html.includes('<script>never()</script>'), false);
  r = await peticion('/admin/catalogo/' + id, { ...valores, nombre: 'TEST-EDITED' }); assert.equal(r.status, 200);
  r = await peticion('/admin/catalogo/' + id + '/estado', {}); assert.equal(r.status, 200);
  html = await (await fetch(url)).text(); assert.equal(html.includes('TEST-EDITED'), false);
  await peticion('/admin/catalogo/' + id + '/estado', {});
  html = await (await fetch(url)).text(); assert.ok(html.includes('TEST-EDITED'));
  await peticion('/admin/catalogo/' + id + '/eliminar', {});
  assert.equal(fixture.servicios.size, 0);
});
test('Work action requires an explicit URL-encoded action and responds before email finishes', async () => {
  let r = await peticion('/admin/trabajo/TEST-OLD', {});
  assert.equal(r.status, 400);
  const inicio = performance.now();
  r = await peticion('/admin/trabajo/TEST-OLD', { accion: 'marcar' });
  assert.equal(r.status, 200); assert.equal((await r.json()).realizado, true);
  assert.ok(performance.now() - inicio < 1000, 'must not wait for the 1200ms fake mailer');
  r = await peticion('/admin?tab=realizados');
  assert.ok((await r.text()).includes('TEST-OLD'));
  r = await peticion('/admin/trabajo/TEST-OLD', { accion: 'desmarcar' });
  assert.equal((await r.json()).realizado, false);
  r = await peticion('/admin?tab=agenda');
  assert.ok((await r.text()).includes('TEST-OLD'));
});
test('Assistant cannot access or modify the catalog', async () => {
  const login = await fetch(url + '/admin/login', {
    method: 'POST', redirect: 'manual', headers: { Origin: url },
    body: new URLSearchParams({ password: 'isolated-assistant-test' }),
  });
  const asistente = login.headers.get('set-cookie').split(';')[0];
  const r = await fetch(url + '/admin/catalogo', { method: 'POST', headers: { Cookie: asistente, Origin: url }, body: new URLSearchParams({}) });
  assert.equal(r.status, 403);
});
