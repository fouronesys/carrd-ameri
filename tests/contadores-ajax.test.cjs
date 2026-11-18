'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');
const { adminDashboard } = require('../lib/templates');
const { agruparClientes } = require('../lib/agenda-clientes');

test('Los contadores cambian antes de recibir la tabla lenta y entregar no descarga pestañas ocultas', async () => {
  const filas = [
    { ref: 'S1', cliente_id: 'A' }, { ref: 'S2', cliente_id: 'A' },
    { ref: 'I', cliente_id: 'B', adelanto: 'incluido' }, { ref: 'RECARGO', cliente_id: 'A', adelanto: 'solo' },
  ].map(r => ({ ...r, estado: 'agendado', precio_cop: 5000, producto: 'Servicio de prueba' }));
  const activos = () => filas.filter(r => !r.trabajo_hecho);
  function resumen() {
    const entregables = activos().filter(r => r.adelanto !== 'solo');
    return { total: activos().length, agendados: entregables.length,
      personas_agendadas: agruparClientes(entregables).length, realizados: filas.filter(r => r.trabajo_hecho).length,
      verificar: 0, catalogo: 0, ingresos: 20000, comisiones: 0, cobrado: 20000, ingresos_sin_desglose: 0 };
  }
  const render = () => adminDashboard({ registros: activos(), resumen: resumen(),
    realizados: filas.filter(r => r.trabajo_hecho), tipoPanel: 'trabajo', cargaPorPestana: true });
  const { document, window: dom } = parseHTML(render());
  const location = { pathname: '/admin', search: '?tab=agenda&tipo=trabajo', href: 'http://fixture/admin?tab=agenda&tipo=trabajo' };
  let liberar, htmlPendiente = false;
  const solicitudes = [];
  const contexto = vm.createContext({
    document, location, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, setInterval() {},
    window: { addEventListener() {}, scrollTo() {}, confirm: () => true },
    history: { replaceState(_, __, url) { location.search = new URL(url, location.href).search; }, pushState() {} },
    mostrarToast() {}, DOMParser: class { parseFromString(html) { return parseHTML(html).document; } },
    FormData: class {
      constructor(form) { this.datos = [...form.querySelectorAll('input[name]')].map(el => [el.name, el.value]); }
      [Symbol.iterator]() { return this.datos[Symbol.iterator](); }
    },
    fetch: async (url, opciones = {}) => {
      solicitudes.push(url);
      if (opciones.method === 'POST') {
        filas.find(r => r.ref === url.split('/').pop()).trabajo_hecho = true;
        return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ ok: true, realizado: true }) };
      }
      if (url.startsWith('/admin/resumen?')) return { ok: true, status: 200,
        headers: { get: () => 'application/json' }, json: async () => ({ ok: true, tipo: 'trabajo', resumen: resumen() }) };
      htmlPendiente = true;
      return { ok: true, text: () => new Promise(resolve => {
        liberar = () => { htmlPendiente = false; resolve(render()); };
      }) };
    },
  });
  for (const nombre of ['admin-contadores', 'admin']) vm.runInContext(
    fs.readFileSync(require.resolve('../assets/' + nombre + '.js'), 'utf8'), contexto);
  const esperar = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
  for (const [ref, personas, trabajos] of [['S1', '2', '2'], ['S2', '1', '1'], ['I', '0', '0']]) {
    const form = document.querySelector('form[action="/admin/trabajo/' + ref + '"]');
    form.method = 'post';
    form.dispatchEvent(new dom.Event('submit', { bubbles: true, cancelable: true }));
    await esperar();
    assert.equal(htmlPendiente, true);
    assert.equal(document.getElementById('stat-personas').textContent, personas);
    assert.equal(document.getElementById('stat-agendados').textContent, trabajos,
      'El total ya cambió aunque el HTML continúe pendiente');
    assert.equal(document.querySelectorAll('#cuerpo-tabla tr[data-ref]').length, activos().length + 1,
      'La tabla no tuvo que terminar de cargar para actualizar las cifras');
    liberar();
    await esperar();
  }
  assert.equal(document.querySelector('[data-tab=realizados] .tab-count').textContent, '3');
  assert.equal(document.getElementById('stat-total').textContent, '1', 'El recargo conserva su registro');
  assert.equal(solicitudes.filter(url => url.includes('/resumen?')).length, 3);
  assert.equal(solicitudes.filter(url => url.includes('tab=realizados')).length, 0);
});
