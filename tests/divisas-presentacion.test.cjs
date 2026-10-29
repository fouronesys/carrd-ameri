'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { parseHTML } = require('linkedom');
const { crearDivisas, DIVISAS } = require('../lib/divisas');
const { crearCotizaciones } = require('../lib/cotizaciones');
const { tasasPrueba } = require('./helpers/tasas.cjs');

test('Banderas, formatos y resumen firmado: once divisas sin duplicar COP antes de Wompi', async () => {
  const { document, Event, CustomEvent, HTMLSelectElement } = parseHTML('<html><head></head><body><section id="prueba"></section><div id="resumen"></div></body></html>');
  Object.defineProperty(HTMLSelectElement.prototype, 'value', {
    configurable: true,
    get() { return (this.querySelector('option[selected]') || this.querySelector('option'))?.value || ''; },
    set(v) { for (const o of this.querySelectorAll('option')) o.toggleAttribute('selected', o.value === v); },
  });
  const fx = crearDivisas({ fetchImpl: async () => ({ ok: true, json: async () => tasasPrueba() }) });
  const tasas = await fx.obtener();
  let respuesta;
  const ctx = vm.createContext({
    document, Event, CustomEvent, console, navigator: { language: 'es-CO' },
    localStorage: { getItem() { return 'COP'; }, setItem() {} },
    dispatchEvent() {}, setTimeout, clearTimeout,
    fetch: async ruta => ({ ok: true, json: async () => ruta === '/api/divisas' ? tasas : respuesta }),
  });
  vm.runInContext('window = globalThis;', ctx);
  vm.runInContext(fs.readFileSync(require.resolve('../assets/divisas.js'), 'utf8'), ctx);
  const D = ctx.FresaDivisas;
  await D.listo;
  const selector = D.montarSelector(document.getElementById('prueba'));
  assert.equal(selector.querySelectorAll('.fd-op svg').length, 11);
  assert.equal(selector.querySelector('[data-v="EUR"]').textContent.includes('Euro'), true);
  const cot = crearCotizaciones({ divisas: fx, secreto: 'sintetico',
    resolver: async i => ({ ...i, tipo: 'hechizo' }), descuento: async () => 10,
    comision: n => n + 1000, adelanto: () => ({ precio_usd: 10 }) });
  const resumen = document.getElementById('resumen');
  for (const { codigo: divisa } of DIVISAS) {
    D.establecer(divisa);
    assert.ok(selector.querySelector('.fd-btn svg'), divisa);
    assert.ok(selector.querySelector('.fd-btn').textContent.includes(divisa));
    const datos = { divisa, metodo: 'wompi', items: [{ nombre: 'Prueba', precio_cop: 50000, precio_usd: 20, incluye_adelanto: true }] };
    const quote = await cot.crear(datos);
    D.pintarCotizacion(resumen, { fase: 'lista', datos: quote });
    assert.match(resumen.textContent, new RegExp(divisa));
    assert.equal(resumen.querySelector('.fd-cot-total strong').textContent, (divisa === 'COP' ? '' : '≈ ') + D.fmt(quote.total_divisa, divisa));
    if (divisa !== 'COP') {
      assert.match(resumen.textContent, /Total aproximado/);
      assert.doesNotMatch(resumen.textContent, /COP\s*[\d$]|[\d]\s*COP/);
    }
    const manual = await cot.crear({ ...datos, metodo: 'transferencia' });
    D.pintarCotizacion(resumen, { fase: 'lista', datos: manual });
    assert.match(resumen.textContent, /Total exacto a transferir/);
    assert.ok(resumen.textContent.includes(D.fmt(manual.total_cop, 'COP')));
    respuesta = { ...quote, items: quote.items.map(({ importe_divisa, ...i }) => i), divisa: 'MXN' };
    await assert.rejects(D.cotizar({ ...datos, divisa: 'MXN' }), /resumen/);
  }

  // El refresco se dispara 20 s antes del vencimiento, no al recibir una
  // cotización de corta duración. Controlar el reloj evita esperas reales.
  const timers = new Map();
  let timerId = 0;
  ctx.setTimeout = (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; };
  ctx.clearTimeout = id => timers.delete(id);
  const datos = { divisa: 'EUR', metodo: 'wompi', items: [{ nombre: 'Prueba', precio_cop: 50000, precio_usd: 20 }] };
  respuesta = { ...await cot.crear(datos), expires_at: new Date(Date.now() + 30000).toISOString() };
  const estados = [];
  const control = D.cotizador(s => estados.push(s));
  const resolverPromesas = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  control.pedir(datos);
  assert.equal(control.listo(), false, 'Bloqueado durante la petición');
  await resolverPromesas();
  assert.equal(control.listo(), true, 'Una cotización inicial vigente no requiere revisión adicional');
  const timer = [...timers.values()][0];
  assert.ok(timer.ms > 9000 && timer.ms <= 10000);
  timer.fn();
  assert.equal(control.listo(), false, 'Bloqueado mientras renueva la cotización');
  await resolverPromesas();
  assert.equal(control.estado().fase, 'lista');
  assert.equal(control.estado().revisar, true);
  assert.equal(control.listo(), false, 'El refresco automático exige revisar el nuevo total');
  D.pintarCotizacion(resumen, control.estado());
  assert.ok(resumen.querySelector('[data-fd-accion="confirmar"]'));
  control.confirmarRevision();
  assert.equal(control.listo(), true);
  respuesta = { ...respuesta, total_divisa: undefined };
  control.pedir(datos);
  await resolverPromesas();
  assert.equal(control.estado().fase, 'error');
  assert.equal(control.listo(), false, 'Desglose incompleto nunca habilita el pago');
  assert.ok(estados.some(s => s.fase === 'expirada'));
  control.reiniciar();
});
