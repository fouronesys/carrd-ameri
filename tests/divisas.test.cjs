'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { crearDivisas, DIVISAS } = require('../lib/divisas');
const { crearCotizaciones, huellaCotizacion } = require('../lib/cotizaciones');
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
    comision: n => n + 1033, adelanto: () => ({ precio_usd: 10, precio_cop: 28000 }) });
  const items = [1.13, 2.17, 3.19].map((precio_usd, i) => ({ nombre: 'Sintético ' + i, precio_cop: 10000, precio_usd, incluye_adelanto: i === 0 }));
  for (const { codigo: divisa } of DIVISAS) {
    for (const metodo of ['wompi', 'transferencia']) {
      const datos = { items, metodo, divisa }, q = await cot.crear(datos);
      const precision = ['COP', 'CLP', 'PYG'].includes(divisa) ? 1 : 100;
      const sum = q.items.reduce((n, i) => n + Math.round(i.importe_divisa * precision), 0);
      assert.equal(sum, Math.round(q.subtotal_divisa * precision), divisa);
      assert.equal(sum + Math.round(q.comision_divisa * precision), Math.round(q.total_divisa * precision), divisa);
      assert.equal(q.total_divisa, divisa === 'COP' ? q.total_cop : Math.round(q.total_cop / q.tasa_cop * q.tasa_divisa * precision) / precision);
      assert.equal(cot.validar(q.token, datos).comision_divisa, q.comision_divisa);
      if (metodo === 'transferencia') assert.equal(q.comision_divisa, 0);
    }
  }
});

test('Tarifas independientes: COP original fijo; USD y otras divisas usan USD sin alterar pedidos', async () => {
  let tasaCop = 4000;
  const cot = crearCotizaciones({ secreto: 'sintetico',
    divisas: { obtener: async () => ({ tasas: { ...tasasPrueba().rates, COP: tasaCop },
      actualizado_en: new Date().toISOString(), vigente_hasta: new Date(Date.now() + 3600000).toISOString() }) },
    resolver: async i => ({ ...i, tipo: i.nombre === 'Lectura' ? 'lectura' : 'hechizo' }),
    descuento: async () => 20, comision: n => n + 1000,
    adelanto: () => ({ precio_usd: 10, precio_cop: 28000 }) });
  const datos = { items: [
    { nombre: 'Hechizo', precio_cop: 50000, precio_usd: 20, incluye_adelanto: true },
    { nombre: 'Lectura', precio_cop: 40000, precio_usd: 15 },
  ], metodo: 'wompi' };
  for (const tasa of [4000, 3200]) {
    tasaCop = tasa;
    const cop = await cot.crear({ ...datos, divisa: 'COP' });
    assert.deepEqual(cop.items.map(i => i.cop), [68000, 40000]);
    assert.deepEqual(cop.items.map(i => i.base_cop), [50000, 40000]);
    assert.equal(cop.total_cop, 109000);
    assert.equal(cop.total_divisa, 109000);
    assert.equal(cop.tarifa, 'COP');
    assert.equal(cot.validar(cop.token, datos).total_cop, 109000);
    const manual = await cot.crear({ ...datos, divisa: 'COP', metodo: 'transferencia' });
    assert.equal(manual.total_cop, 108000);
    for (const divisa of ['USD', 'EUR', 'MXN']) {
      const q = await cot.crear({ ...datos, divisa });
      assert.equal(q.subtotal_cop, 41 * tasa);
      assert.equal(q.total_cop, 41 * tasa + 1000);
      assert.equal(q.tarifa, 'USD');
    }
  }
});

test('COP no consulta al proveedor: descuento, urgencia, comisión, huella y vencimiento propios', async () => {
  let tiempo = Date.now(), llamadas = 0;
  const cot = crearCotizaciones({ secreto: 'aislado', ahora: () => tiempo,
    divisas: { obtener: async () => { llamadas++; throw new Error('Proveedor caído'); } },
    resolver: async i => ({ ...i, tipo: 'hechizo' }), descuento: async () => 20,
    comision: n => n + 1000, adelanto: () => ({ precio_cop: 28000, precio_usd: 10 }) });
  const datos = { divisa: 'COP', items: [{ nombre: 'Sintético', precio_cop: 50000, precio_usd: 20, incluye_adelanto: true }] };
  const q = await cot.crear(datos);
  assert.equal(llamadas, 0);
  assert.equal(q.total_cop, 69000);
  assert.equal(q.subtotal_divisa, 68000);
  assert.equal(q.comision_divisa, 1000);
  assert.equal(q.items[0].importe_divisa, 68000);
  assert.equal(q.tasa_cop, null);
  assert.equal(q.tasa_divisa, null);
  assert.equal(q.actualizado_en, null);
  assert.equal(q.conversion_aplicada, false);
  assert.deepEqual(huellaCotizacion(q), {
    base_divisa: 'COP', conversion_aplicada: false, tasa_usd_cop: null, tasa_actualizada_en: null,
    cotizacion_vence_en: new Date(tiempo + 900000).toISOString(), divisa_vista: 'COP',
  });
  assert.equal(cot.validar(q.token, datos).total_cop, 69000);
  assert.throws(() => cot.validar(q.token + 'x', datos), /válida/);
  assert.throws(() => cot.validar(q.token, { ...datos, items: [{ ...datos.items[0], precio_cop: 1 }] }), /cambió/);
  assert.equal((await cot.crear({ ...datos, metodo: 'transferencia' })).total_cop, 68000);
  tiempo += 900000;
  assert.throws(() => cot.validar(q.token, datos), /venció/);
});

test('Proveedor caído, tasas inválidas o vencidas: COP funciona y todas las extranjeras se bloquean', async () => {
  for (const proveedor of [
    async () => { throw new Error('Sin conexión'); },
    async () => ({ ok: false }),
    async () => ({ ok: true, json: async () => ({ ...tasasPrueba(), time_last_update_unix: 1 }) }),
    async () => ({ ok: true, json: async () => ({ ...tasasPrueba(), rates: { USD: 1 } }) }),
  ]) {
    const fx = crearDivisas({ fetchImpl: proveedor });
    const cot = crearCotizaciones({ divisas: fx, secreto: 'aislado',
      resolver: async i => ({ ...i, tipo: 'lectura' }), descuento: async () => 0,
      comision: n => n + 1000, adelanto: () => ({ precio_cop: 28000, precio_usd: 10 }) });
    const datos = { items: [{ nombre: 'Lectura sintética', precio_cop: 40000, precio_usd: 15 }] };
    await assert.rejects(fx.obtener(), /tasa/);
    assert.equal((await cot.crear({ ...datos, divisa: 'COP' })).total_cop, 41000);
    for (const { codigo } of DIVISAS.filter(d => d.codigo !== 'COP')) {
      await assert.rejects(cot.crear({ ...datos, divisa: codigo }), /disponible/);
    }
  }
});
