'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');
const templates = require('../lib/templates');
const { opcionesAgenda } = require('../lib/agenda-panel');

test('Navegación AJAX conserva búsqueda, historial y página; entregar ajusta última página y totales', async () => {
  let trabajos = Array.from({ length: 31 }, (_, i) => ({
    ref: 'R-' + i, cliente_id: 'C-' + i, cliente_nombre: 'Comprador ' + i,
    producto: 'Servicio', estado: 'agendado',
  }));
  const solicitudes = [], eventos = {}, mensajes = [];
  const location = { pathname: '/admin', search: '?tab=agenda&pagina=2' };
  function render(url) {
    const params = Object.fromEntries(new URL(url, 'http://fixture').searchParams);
    const filtros = opcionesAgenda(params);
    const lista = trabajos.filter(r => !filtros.buscar || r.cliente_nombre.includes(filtros.buscar));
    const paginas = Math.max(1, Math.ceil(lista.length / 15));
    const pagina = Math.min(filtros.pagina, paginas);
    return templates.adminDashboard({
      tabActiva: params.tab || 'agenda', cargaPorPestana: true,
      registros: lista.slice((pagina - 1) * 15, pagina * 15),
      agenda: { ...filtros, pagina, paginas, personas: lista.length, trabajos: lista.length },
      resumen: { total: trabajos.length, agendados: trabajos.length, personas_agendadas: trabajos.length },
    });
  }
  const { document } = parseHTML(render('/admin' + location.search));
  const cambiarUrl = (_, __, url) => { location.search = new URL(url, 'http://fixture').search; };
  class FormDataFixture {
    constructor(form) { this.pares = [...form.querySelectorAll('input[name]')].map(el => [el.name, el.value]); }
    [Symbol.iterator]() { return this.pares[Symbol.iterator](); }
    forEach(fn) { this.pares.forEach(([k, v]) => fn(v, k)); }
  }
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/admin.js'), 'utf8'), {
    document, location, URLSearchParams, FormData: FormDataFixture,
    history: { pushState: cambiarUrl, replaceState: cambiarUrl },
    window: { addEventListener: (tipo, fn) => { eventos[tipo] = fn; }, scrollTo() {} },
    DOMParser: class { parseFromString(html) { return parseHTML(html).document; } },
    mostrarToast: mensaje => mensajes.push(mensaje),
    fetch: async (url, opciones) => {
      solicitudes.push(url);
      if (opciones.method === 'POST') {
        trabajos = trabajos.filter(r => r.ref !== url.split('/').pop());
        return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ ok: true, realizado: true }) };
      }
      return { ok: true, text: async () => render(url) };
    },
  });
  const terminar = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
  const click = async selector => {
    document.querySelector(selector).click();
    await terminar();
  };
  await click('[aria-label="Páginas de la agenda"] a:last-child');
  assert.equal(new URLSearchParams(location.search).get('pagina'), '3');
  assert.equal(document.querySelectorAll('#cuerpo-tabla tr[data-ref]').length, 1);
  const form = document.querySelector('.trabajo-form');
  form.method = 'post'; // linkedom no implementa la propiedad HTMLFormElement.method.
  form.dispatchEvent(new (parseHTML('').window.Event)('submit', { bubbles: true, cancelable: true }));
  await terminar();
  assert.ok(mensajes.includes('Trabajo marcado como entregado'));
  assert.equal(new URLSearchParams(location.search).get('pagina'), '2', 'Se ajusta la página al entregar el último comprador');
  assert.equal(document.querySelector('#stat-personas').textContent, '30');
  assert.equal(document.querySelectorAll('#cuerpo-tabla tr[data-ref]').length, 15);
  assert.ok(solicitudes.some(u => u.includes('tab=realizados')));
  await click('[data-tab="realizados"]');
  await click('[data-tab="agenda"]');
  assert.equal(new URLSearchParams(location.search).get('pagina'), '2');
  const buscar = document.querySelector('#agenda-busqueda');
  buscar.querySelector('[name=buscar]').value = 'Comprador 2';
  buscar.dispatchEvent(new (parseHTML('').window.Event)('submit', { bubbles: true, cancelable: true }));
  await terminar();
  assert.equal(new URLSearchParams(location.search).get('pagina'), '1');
  assert.equal(document.querySelectorAll('#cuerpo-tabla tr[data-ref]').length, 11);
  assert.equal(document.querySelector('#stat-personas').textContent, '30');
  await click('[data-filtro=agendado]');
  assert.equal(new URLSearchParams(location.search).get('buscar'), 'Comprador 2');
  assert.equal(document.querySelector('#buscador').value, 'Comprador 2');
  location.search = '?tab=agenda&pagina=2';
  eventos.popstate();
  await terminar();
  assert.equal(document.querySelectorAll('#cuerpo-tabla tr[data-ref]').length, 15);
  assert.equal(document.querySelector('#buscador').value, '');
});
