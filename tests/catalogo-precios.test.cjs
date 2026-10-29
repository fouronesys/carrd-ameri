'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const precios = require('../lib/catalogo-precios');
const htmlOriginal = fs.readFileSync(require.resolve('../index.html'), 'utf8');
const base = precios.originales(htmlOriginal);
let fixture, server, url, cookie;
before(async () => {
  Object.assign(process.env, { ADMIN_PASSWORD: 'isolated-admin-test', ASSISTANT_PASSWORD: 'isolated-assistant-test',
    SESSION_SECRET: 'sintetico-precios', NODE_ENV: 'test' });
  fixture = require('./helpers/admin-fixture.cjs');
  server = fixture.app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  url = 'http://127.0.0.1:' + server.address().port;
  cookie = await login('isolated-admin-test');
});
after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); });
async function login(password) {
  const r = await fetch(url + '/admin/login', { method: 'POST', redirect: 'manual',
    headers: { Origin: url }, body: new URLSearchParams({ password }) });
  return r.headers.get('set-cookie').split(';')[0];
}
async function req(path, body, session = cookie, origin = url) {
  const r = await fetch(url + path, { method: body ? 'POST' : 'GET', redirect: 'manual',
    headers: { Cookie: session, Origin: origin, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text }; }
  return { status: r.status, data };
}
test('El editor incluye todos los originales sin duplicarlos ni reescribir el archivo', () => {
  assert.equal(base.size, 106);
  assert.equal([...base.values()].filter(i => i.tipo === 'hechizo').length, 83);
  assert.equal([...base.values()].filter(i => i.tipo === 'lectura').length, 23);
  const item = [...base.values()][0];
  const nuevo = { ...item, precio_cop: 99999, precio_usd: 12.34 };
  const html = precios.aplicarHtml(htmlOriginal, base, [nuevo]);
  assert.ok(html.includes('data-catalogo-id="' + item.id + '"'));
  assert.ok(html.includes('$99.999'));
  assert.ok(html.includes('12.34 USD'));
  assert.equal(precios.listar(base, [nuevo]).length, 106);
  assert.equal(require('../lib/catalogo').resumen(htmlOriginal, [nuevo]).hechizo.total, 83);
});
test('Precios: permisos, validación, confirmación firmada, publicación y conflictos', async () => {
  assert.equal((await req('/admin/catalogo/precios', null, '')).status, 401);
  const asistente = await login('isolated-assistant-test');
  assert.equal((await req('/admin/catalogo/precios', null, asistente)).status, 403);
  const lista = await req('/admin/catalogo/precios');
  assert.equal(lista.data.items.length, 106);
  const first = lista.data.items[0], lectura = lista.data.items.find(i => i.tipo === 'lectura');
  const cambios = [first, lectura].map(i => ({ id: i.id, revision: i.revision, precio_cop: i.precio_cop + 1000, precio_usd: i.precio_usd + 1 }));
  assert.equal((await req('/admin/catalogo/precios/preview', { cambios }, cookie, 'https://otro.example')).status, 403);
  assert.equal((await req('/admin/catalogo/precios/preview', { cambios: [{ ...cambios[0], precio_cop: -1 }] })).status, 400);
  assert.equal((await req('/admin/catalogo/precios/preview', { cambios: [cambios[0], cambios[0]] })).status, 400);
  assert.equal((await req('/admin/catalogo/precios/preview', { cambios: [{ ...cambios[0], precio_usd: 1.001 }] })).status, 400);
  const preview = await req('/admin/catalogo/precios/preview', { cambios });
  assert.equal(preview.status, 200);
  assert.equal(fixture.servicios.size, 0, 'La vista previa no escribe');
  assert.equal((await req('/admin/catalogo/precios/aplicar', { token: preview.data.token + 'x' })).status, 409);
  assert.equal((await req('/admin/catalogo/precios/aplicar', { token: preview.data.token }, asistente)).status, 403);
  const aplicado = await req('/admin/catalogo/precios/aplicar', { token: preview.data.token });
  assert.equal(aplicado.data.actualizados, 2);
  assert.equal(fixture.historial.length, 2);
  assert.equal((await req('/admin/catalogo/precios/aplicar', { token: preview.data.token })).status, 409);
  const publico = await (await fetch(url + '/')).text();
  assert.ok(publico.includes('data-catalogo-id="' + first.id + '"'));
  assert.equal((publico.match(new RegExp('data-catalogo-id="' + first.id + '"', 'g')) || []).length, 1);
  const old = await req('/api/cotizacion', { divisa: 'COP', items: [{
    nombre: first.nombre, precio_cop: first.precio_cop, precio_usd: first.precio_usd,
  }] });
  assert.notEqual(old.status, 200, 'Un carrito antiguo no conserva el precio anterior');
  const fresh = await req('/api/cotizacion', { divisa: 'COP', metodo: 'transferencia', items: [{
    catalogo_id: first.id, nombre: first.nombre, precio_cop: cambios[0].precio_cop, precio_usd: cambios[0].precio_usd,
  }] });
  assert.equal(fresh.data.total_cop, cambios[0].precio_cop);
  const navegador = await require('./helpers/navegador-compra.cjs').navegador(url, publico,
    (ruta, options) => fetch(url + ruta, { ...options, headers: { Origin: url, ...options?.headers } }));
  try {
    navegador.divisa('COP');
    const ficha = navegador.document.querySelector('[data-catalogo-id="' + first.id + '"]');
    assert.ok(ficha.querySelector('.wm-pay-btn'));
    navegador.click(ficha.querySelector('.wm-pay-btn'));
    await navegador.listo();
    const quote = navegador.solicitudes.filter(r => r.ruta === '/api/cotizacion').at(-1);
    assert.equal(quote.status, 200);
    assert.equal(quote.data.items[0].cop, cambios[0].precio_cop);
    navegador.click(ficha.querySelector('.carrito'));
    assert.equal(navegador.carrito()[0].precio_cop, cambios[0].precio_cop);
    assert.equal(Number(navegador.carrito()[0].precio_usd), cambios[0].precio_usd);
  } finally { navegador.cerrar(); }
  assert.equal((await req('/admin/catalogo/' + first.id + '/eliminar', {})).status, 400);
  assert.equal(fs.readFileSync(require.resolve('../index.html'), 'utf8'), htmlOriginal);
});
test('La confirmación está vinculada al administrador y caduca', () => {
  const firma = precios.crearConfirmaciones('solo-prueba');
  const c = firma.crear([{ id: 'x' }], 'admin-1');
  assert.throws(() => firma.validar(c.token, 'admin-2'), /venció/);
  const original = Date.now;
  try {
    Date.now = () => original() + 11 * 60000;
    assert.throws(() => firma.validar(c.token, 'admin-1'), /venció/);
  } finally { Date.now = original; }
});
