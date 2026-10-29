'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { navegador } = require('./helpers/navegador-compra.cjs');

test('Sin proveedor: selector COP, compras individuales y carrito HTTP con firma y huella sin conversión', async () => {
  Object.assign(process.env, {
    NODE_ENV: 'test', ADMIN_PASSWORD: 'admin-aislado', ASSISTANT_PASSWORD: 'asistente-aislado',
    SESSION_SECRET: 'sesion-aislada', WOMPI_PUBLIC_KEY: 'pub_test_sintetica',
    WOMPI_PRIVATE_KEY: 'prv_test_sintetica', WOMPI_INTEGRITY_SECRET: 'integridad-aislada',
  });
  process.argv.push('--sin-tasas');
  const fixture = require('./helpers/admin-fixture.cjs');
  let correos = 0;
  const mail = require('../lib/mailer');
  for (const key of Object.keys(mail)) mail[key] = async () => { correos++; throw new Error('Correo prohibido'); };
  const server = fixture.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  const request = (ruta, options) => fetch(url + ruta, { ...options, headers: { Origin: url, ...options?.headers } });
  const post = async (ruta, datos) => {
    const res = await request(ruta, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos) });
    return { status: res.status, data: await res.json() };
  };
  let browser;
  try {
    assert.equal((await request('/api/divisas')).status, 503);
    browser = await navegador(url, await (await request('/')).text(), request);
    const D = browser.divisas;
    assert.equal(D.actual(), 'COP');
    assert.equal(D.hayTasas(), false);
    assert.equal(D.convertir(20, 'COP'), null, 'No inventar una conversión USD/COP');
    const selector = D.montarSelector(browser.document.body);
    assert.equal(selector.querySelector('.fd-btn').disabled, false);
    assert.ok(selector.querySelector('[data-v="COP"]'));
    assert.match(selector.querySelector('.fd-nota').textContent, /tarifa COP original/);
    D.establecer('USD');
    D.establecer('COP');
    assert.equal(D.actual(), 'COP');
    await D.reintentar();
    assert.equal(D.actual(), 'COP', 'Un nuevo fallo no cambia la selección');
    const catalogo = [...require('../lib/catalogo-compra').cargarEstaticos(fs.readFileSync(require.resolve('../index.html'), 'utf8')).values()];
    const lectura = catalogo.find(i => i.tipo === 'lectura');
    const hechizo = catalogo.find(i => i.tipo === 'hechizo');
    const item = i => ({ nombre: i.nombre, precio_cop: i.precio_cop, precio_usd: i.precio_usd, objetivo_nombre: 'Objetivo sintético' });
    const firma = (ref, total) => crypto.createHash('sha256').update(ref + String(total * 100) + 'COPintegridad-aislada').digest('hex');
    for (const carrito of [false, true]) {
      const items = carrito ? [item(lectura), { ...item(hechizo), incluye_adelanto: true }] : [item(lectura)];
      const datos = { divisa: 'COP', metodo: 'wompi', items };
      const quote = await D.cotizar(datos);
      const subtotal = items.reduce((s, i) => s + i.precio_cop + (i.incluye_adelanto ? 28000 : 0), 0);
      assert.equal(quote.subtotal_cop, subtotal);
      assert.equal(quote.total_cop, Math.ceil((subtotal + 700 * 1.19) / (1 - 0.0265 * 1.19)));
      const campos = { metodo: 'wompi', cliente_nombre: 'Comprador sintético', contacto: 'Contacto sintético',
        cotizacion: quote.token, ...(carrito ? { items: JSON.stringify(items) } : {
          producto: lectura.nombre, precio_cop: lectura.precio_cop, precio_usd: lectura.precio_usd, objetivo_nombre: 'Objetivo sintético',
        }) };
      const ruta = carrito ? '/api/checkout' : '/api/booking';
      const enviar = async token => {
        const body = new FormData();
        for (const [k, v] of Object.entries({ ...campos, cotizacion: token })) body.set(k, v);
        const res = await request(ruta, { method: 'POST', body });
        return { status: res.status, data: await res.json() };
      };
      const antes = fixture.trabajos.size;
      assert.equal((await enviar(quote.token + 'x')).status, 409);
      assert.equal(fixture.trabajos.size, antes);
      const pago = await enviar(quote.token);
      assert.equal(pago.status, 200, JSON.stringify(pago.data));
      const ref = carrito ? pago.data.pedido_ref : pago.data.ref;
      assert.equal(pago.data.signature, firma(ref, quote.total_cop));
      assert.equal(carrito ? pago.data.total_cop : pago.data.precio_cop, quote.total_cop);
      const registros = [...fixture.trabajos.values()].filter(r => carrito ? r.pedido_ref === ref : r.ref === ref);
      assert.equal(registros.length, items.length);
      for (const r of registros) {
        assert.equal(r.conversion_aplicada, false);
        assert.equal(r.tasa_usd_cop, null);
        assert.equal(r.tasa_actualizada_en, null);
        assert.equal(r.estado, 'pendiente_pago');
      }
      for (const divisa of ['USD', 'EUR', 'MXN']) {
        const antes = fixture.trabajos.size;
        assert.equal((await post('/api/cotizacion', { ...datos, divisa })).status, 503);
        assert.equal(fixture.trabajos.size, antes);
      }
    }
    assert.equal(correos, 0);
  } finally {
    browser?.cerrar();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    process.argv.splice(process.argv.indexOf('--sin-tasas'), 1);
  }
});
