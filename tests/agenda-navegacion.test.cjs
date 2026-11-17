'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');
const templates = require('../lib/templates');
const { opcionesAgenda } = require('../lib/agenda-panel');

test('Navegación AJAX conserva vista e historial; entregar no desplaza páginas y actualizar renueva la vista', async () => {
  let trabajos = Array.from({ length: 31 }, (_, i) => ({
    ref: 'R-' + i, cliente_id: 'C-' + i, cliente_nombre: 'Comprador ' + i,
    producto: 'Servicio', estado: 'agendado',
  }));
  const solicitudes = [], eventos = {}, mensajes = [];
  let comprobarAgenda, cambios = false, caducada = false, falloComprobacion = false, confirmar = false;
  const vistas = new Map();
  const location = { pathname: '/admin', search: '?tab=agenda&pagina=2', href: 'http://fixture/admin' };
  function render(url) {
    const params = Object.fromEntries(new URL(url, 'http://fixture').searchParams);
    const filtros = opcionesAgenda(params);
    const lista = trabajos.filter(r => !filtros.buscar || r.cliente_nombre.includes(filtros.buscar));
    let vista = params.vista;
    if (!vistas.has(vista)) {
      vista = 'vista-' + vistas.size;
      vistas.set(vista, lista.map(r => r.ref));
    }
    const refs = vistas.get(vista);
    const paginas = Math.max(1, Math.ceil(refs.length / 15));
    const pagina = Math.min(filtros.pagina, paginas);
    return templates.adminDashboard({
      tabActiva: params.tab || 'agenda', cargaPorPestana: true,
      registros: refs.slice((pagina - 1) * 15, pagina * 15).flatMap(ref => trabajos.filter(r => r.ref === ref)),
      agenda: { ...filtros, vista, pagina, paginas, personas: refs.length, trabajos: refs.length },
      resumen: { total: trabajos.length, agendados: trabajos.filter(r => r.estado === 'agendado' && !r.trabajo_hecho).length,
        personas_agendadas: trabajos.filter(r => r.estado === 'agendado' && !r.trabajo_hecho).length },
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
    document, location, URL, URLSearchParams, FormData: FormDataFixture, setTimeout, clearTimeout,
    setInterval: (fn, ms) => { assert.equal(ms, 30000); comprobarAgenda = fn; },
    history: { pushState: cambiarUrl, replaceState: cambiarUrl },
    window: { addEventListener: (tipo, fn) => { eventos[tipo] = fn; }, scrollTo() {}, confirm: () => confirmar },
    DOMParser: class { parseFromString(html) { return parseHTML(html).document; } },
    mostrarToast: mensaje => mensajes.push(mensaje),
    fetch: async (url, opciones) => {
      solicitudes.push(url);
      if (url.includes('comprobar_agenda=1')) {
        if (falloComprobacion) throw new Error('sin conexión');
        return { ok: true, json: async () => ({ cambios, caducada }) };
      }
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
  const vistaInicial = new URLSearchParams(location.search).get('vista');
  assert.ok(vistaInicial, 'La primera carga registra la vista en el historial');
  await click('[aria-label="Páginas de la agenda"] a:last-child');
  assert.equal(new URLSearchParams(location.search).get('vista'), vistaInicial);
  assert.equal(new URLSearchParams(location.search).get('pagina'), '3');
  assert.equal(document.querySelectorAll('#cuerpo-tabla tr[data-ref]').length, 1);
  const form = document.querySelector('.trabajo-form');
  form.method = 'post'; // linkedom no implementa la propiedad HTMLFormElement.method.
  form.dispatchEvent(new (parseHTML('').window.Event)('submit', { bubbles: true, cancelable: true }));
  await terminar();
  assert.ok(mensajes.includes('Trabajo marcado como entregado'));
  assert.equal(new URLSearchParams(location.search).get('pagina'), '3', 'Entregar no mueve los límites del recorrido');
  assert.equal(new URLSearchParams(location.search).get('vista'), vistaInicial);
  assert.equal(document.querySelector('#stat-personas').textContent, '30');
  assert.equal(document.querySelector('#stat-agendados').textContent, '30', 'El contador baja al entregar un trabajo');
  assert.equal(document.querySelector('#stat-total').textContent, '30', 'El total activo se sincroniza también');
  assert.equal(document.querySelectorAll('#cuerpo-tabla tr[data-ref]').length, 0);
  assert.match(document.querySelector('#sin-resultados').textContent, /ya no tienen servicios activos/);
  await click('[aria-label="Páginas de la agenda"] a');
  assert.equal(document.querySelectorAll('#cuerpo-tabla tr[data-ref]').length, 15);
  assert.ok(solicitudes.some(u => u.includes('tab=realizados')));
  await click('[data-tab="realizados"]');
  await click('[data-tab="agenda"]');
  assert.equal(new URLSearchParams(location.search).get('pagina'), '2');
  const buscar = document.querySelector('#agenda-busqueda');
  buscar.querySelector('[name=buscar]').value = 'Comprador 2';
  buscar.querySelector('[name=buscar]').dispatchEvent(new (parseHTML('').window.Event)('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 350));
  await terminar();
  assert.equal(new URLSearchParams(location.search).get('pagina'), '1');
  assert.equal(document.querySelectorAll('#cuerpo-tabla tr[data-ref]').length, 11);
  assert.equal(document.querySelector('#stat-personas').textContent, '30');
  await click('[data-filtro=agendado]');
  assert.equal(new URLSearchParams(location.search).get('buscar'), 'Comprador 2');
  assert.equal(document.querySelector('#buscador').value, 'Comprador 2');
  assert.notEqual(new URLSearchParams(location.search).get('vista'), vistaInicial);
  const antesDeActualizar = new URLSearchParams(location.search).get('vista');
  await click('#agenda-busqueda a[href*="pagina=1"]');
  assert.notEqual(new URLSearchParams(location.search).get('vista'), antesDeActualizar);
  assert.equal(new URLSearchParams(location.search).get('buscar'), 'Comprador 2');
  location.search = '?tab=agenda&pagina=2';
  eventos.popstate();
  await terminar();
  assert.equal(document.querySelectorAll('#cuerpo-tabla tr[data-ref]').length, 15);
  assert.equal(document.querySelector('#buscador').value, '');
  assert.ok(new URLSearchParams(location.search).get('vista'), 'Atrás normaliza la URL con su vista');
  const urlPagina = document.querySelector('[aria-label="Páginas de la agenda"] a');
  document.querySelector('#buscador').value = 'Comprador 2';
  urlPagina.click(); // Navegar antes de que termine la espera de búsqueda.
  await terminar();
  const ultimaSolicitud = new URL(solicitudes.at(-1), 'http://fixture');
  assert.equal(ultimaSolicitud.searchParams.get('vista'), null);
  assert.equal(ultimaSolicitud.searchParams.get('pagina'), '1');
  // Otro administrador confirma un urgente fuera del recorrido actual.
  const formularioAbierto = document.querySelector('[data-sec=agenda] .edit-row');
  formularioAbierto.style.display = 'table-row';
  const campoEdicion = formularioAbierto.querySelector('input[name]');
  campoEdicion.value = 'Edición todavía sin guardar';
  const tablaAntes = document.querySelector('#cuerpo-tabla');
  const urlAntes = location.search;
  trabajos.unshift({ ref: 'URGENTE-NUEVO', cliente_id: 'C-URGENTE', cliente_nombre: 'Comprador 2 urgente',
    producto: 'Servicio urgente', estado: 'agendado', adelanto: 'incluido' });
  cambios = true;
  await comprobarAgenda();
  assert.equal(document.getElementById('agenda-cambios').hidden, false);
  assert.equal(document.querySelector('#cuerpo-tabla'), tablaAntes, 'Comprobar no sustituye la tabla');
  assert.equal(campoEdicion.value, 'Edición todavía sin guardar');
  assert.equal(formularioAbierto.style.display, 'table-row');
  assert.equal(location.search, urlAntes, 'Comprobar no cambia historial ni página');
  assert.equal(document.querySelector('[data-ref=URGENTE-NUEVO]'), null);
  await click('#agenda-cambios a');
  assert.equal(location.search, urlAntes, 'Cancelar renovación protege el formulario');
  falloComprobacion = true;
  await comprobarAgenda();
  assert.equal(document.querySelector('#cuerpo-tabla'), tablaAntes, 'Un fallo de red no toca la edición');
  falloComprobacion = false;
  caducada = true;
  await comprobarAgenda();
  assert.match(document.getElementById('agenda-cambios').textContent, /recorrido caducó/);
  confirmar = true;
  await click('#agenda-cambios a');
  assert.notEqual(new URLSearchParams(location.search).get('vista'), new URLSearchParams(urlAntes).get('vista'));
  assert.ok(document.querySelector('[data-ref=URGENTE-NUEVO]'), 'Solo la actualización voluntaria incluye el nuevo urgente');
  assert.equal(document.getElementById('agenda-cambios').hidden, true);
});
