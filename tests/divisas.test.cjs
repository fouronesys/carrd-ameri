'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { crearDivisas, DIVISAS } = require('../lib/divisas');
const { crearCotizaciones } = require('../lib/cotizaciones');
const { tasasPrueba } = require('./helpers/tasas.cjs');

test('Tasas automáticas: USD base, divisas admitidas, caché y consultas concurrentes coalescidas', async () => {
  let llamadas = 0;
  const fx = crearDivisas({ fetchImpl: async () => { llamadas++; return { ok: true, json: async () => tasasPrueba() }; } });
  const datos = await Promise.all([fx.obtener(), fx.obtener(), fx.obtener()]);
  assert.equal(llamadas, 1);
  assert.equal(datos[0].base, 'USD');
  assert.equal(datos[0].tasas.COP, 4000);
  assert.equal(DIVISAS.length, 11);
  assert.ok(datos[0].divisas.some(d => d.codigo === 'VES'));
  await fx.obtener();
  assert.equal(llamadas, 1);
});

test('Sin tasas vigentes, incompletas o con errores no se inventa precio ni se satura al proveedor', async () => {
  for (const cambio of [
    { result: 'error' }, { base_code: 'EUR' }, { rates: { USD: 1, COP: 4000 } },
    { time_last_update_unix: 1 }, { rates: { ...tasasPrueba().rates, COP: -1 } },
  ]) {
    let llamadas = 0;
    const fx = crearDivisas({ fetchImpl: async () => { llamadas++; return { ok: true, json: async () => ({ ...tasasPrueba(), ...cambio }) }; } });
    await assert.rejects(fx.obtener(), /tasa/);
    await assert.rejects(fx.obtener(), /disponible/);
    assert.equal(llamadas, 1);
  }
});

test('Cotización USD autoritativa: descuentos, urgencia, comisión única y congelación hasta vencimiento', async () => {
  let tiempo = Date.now();
  const items = [{ nombre: 'Hechizo', precio_cop: 50000, precio_usd: 20, tipo: 'hechizo' },
    { nombre: 'Lectura', precio_cop: 40000, precio_usd: 15, tipo: 'lectura' }];
  const fx = crearDivisas({ ahora: () => tiempo, fetchImpl: async () => ({ ok: true, json: async () => tasasPrueba() }) });
  const cot = crearCotizaciones({ divisas: fx, ahora: () => tiempo, secreto: 'sintetico',
    resolver: async raw => items.find(i => i.nombre === raw.nombre && i.precio_cop === Number(raw.precio_cop) && i.precio_usd === Number(raw.precio_usd)),
    descuento: async () => 20, comision: n => n + 1000,
    adelanto: () => ({ precio_usd: 10, precio_cop: 28000, tipo: 'extra', nombre: 'Adelanto' }) });
  const datos = { items: [{ ...items[0], incluye_adelanto: true }, items[1]], metodo: 'wompi', divisa: 'MXN' };
  const q = await cot.crear(datos);
  assert.deepEqual(q.items.map(i => i.usd), [26, 15]);
  assert.equal(q.total_cop, 165000);
  assert.equal(q.total_divisa, 825);
  assert.equal(q.subtotal_divisa, 820);
  assert.equal(q.comision_divisa, 5);
  assert.deepEqual(q.items.map(i => i.importe_divisa), [520, 300]);
  assert.equal(q.items[1].tipo, 'lectura');
  assert.equal(cot.validar(q.token, datos).total_cop, q.total_cop);
  await assert.rejects(cot.crear({ ...datos, items: [{ ...items[1], incluye_adelanto: true }] }), /solo/);
  assert.throws(() => cot.validar(q.token + 'x', datos), /válida/);
  assert.throws(() => cot.validar(q.token, { ...datos, metodo: 'transferencia' }), /cambió/);
  assert.throws(() => cot.validar(q.token, { ...datos, items: [{ ...items[0], precio_usd: 1 }] }), /cambió/);
  const manual = await cot.crear({ ...datos, metodo: 'transferencia' });
  assert.equal(manual.total_cop, 164000);
  tiempo += 16 * 60000;
  assert.throws(() => cot.validar(q.token, datos), /venció/);
});

test('Desglose firmado coherente en las once divisas, incluso al redondear varias filas', async () => {
  const fx = crearDivisas({ fetchImpl: async () => ({ ok: true, json: async () => tasasPrueba() }) });
  const cot = crearCotizaciones({ divisas: fx, secreto: 'sintetico',
    resolver: async raw => ({ ...raw, tipo: 'hechizo' }), descuento: async () => 17,
    comision: n => n + 1033, adelanto: () => ({ precio_usd: 10 }) });
  const items = [1.13, 2.17, 3.19].map((precio_usd, i) => ({ nombre: 'Sintético ' + i, precio_cop: 10000, precio_usd, incluye_adelanto: i === 0 }));
  for (const { codigo: divisa } of DIVISAS) {
    for (const metodo of ['wompi', 'transferencia']) {
      const datos = { items, metodo, divisa }, q = await cot.crear(datos);
      const precision = ['COP', 'CLP', 'PYG'].includes(divisa) ? 1 : 100;
      const sum = q.items.reduce((n, i) => n + Math.round(i.importe_divisa * precision), 0);
      assert.equal(sum, Math.round(q.subtotal_divisa * precision), divisa);
      assert.equal(sum + Math.round(q.comision_divisa * precision), Math.round(q.total_divisa * precision), divisa);
      assert.equal(q.total_divisa, Math.round(q.total_cop / q.tasa_cop * q.tasa_divisa * precision) / precision);
      assert.equal(cot.validar(q.token, datos).comision_divisa, q.comision_divisa);
      if (metodo === 'transferencia') assert.equal(q.comision_divisa, 0);
    }
  }
});
