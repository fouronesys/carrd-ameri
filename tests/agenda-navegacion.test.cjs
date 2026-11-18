'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');
const templates = require('../lib/templates');
const { opcionesAgenda } = require('../lib/agenda-panel');
const { estaEnAgenda, esServicioEntregable } = require('../lib/agenda-panel');
const { agruparClientes } = require('../lib/agenda-clientes');

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
    document, location, URL, URLSearchParams, AbortController, FormData: FormDataFixture, setTimeout, clearTimeout,
    setInterval: (fn, ms) => { assert.equal(ms, 30000); comprobarAgenda = fn; },
    history: { pushState: cambiarUrl, replaceState: cambiarUrl },
    window: { addEventListener: (tipo, fn) => { eventos[tipo] = fn; }, scrollTo() {}, confirm: () => confirmar },
    DOMParser: class { parseFromString(html) { return parseHTML(html).document; } },
    mostrarToast: mensaje => mensajes.push(mensaje),
    fetch: async (url, opciones) => {
      solicitudes.push(url);
      if (url.includes('comprobar_agenda=1')) {
        if (falloComprobacion) throw new Error('sin conexión');
        return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ cambios, caducada }) };
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
  assert.equal(solicitudes.some(u => u.includes('tab=realizados')), false,
    'Entregar desde Agenda no debe descargar todos los entregados de la pestaña oculta');
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

test('AJAX actualiza personas, trabajos y pestañas con adelantos y estados mixtos sin recargar', async () => {
  const trabajos = [
    { ref: 'S', cliente_id: 'C', estado: 'agendado' },
    { ref: 'A', cliente_id: 'C', estado: 'agendado', adelanto: 'solo' },
    { ref: 'P', cliente_id: 'C', estado: 'pendiente_pago' },
    { ref: 'I', cliente_id: 'I', estado: 'agendado', adelanto: 'incluido' },
  ].map(r => ({ producto: 'Servicio ' + r.ref, cliente_nombre: 'Cliente ' + r.cliente_id, ...r }));
  const location = { pathname: '/admin', search: '?tab=agenda&tipo=todos', href: 'http://fixture/admin' };
  const render = url => {
    const params = Object.fromEntries(new URL(url, location.href).searchParams);
    const filtros = opcionesAgenda(params);
    const activos = trabajos.filter(estaEnAgenda);
    const registros = activos.filter(r => (filtros.estado === 'todos' || r.estado === filtros.estado) &&
      (filtros.adelanto !== 'si' || require('../lib/agenda-panel').esAdelantoPrioritario(r)));
    const pagados = activos.filter(r => r.estado === 'agendado' && esServicioEntregable(r));
    const realizados = trabajos.filter(r => r.trabajo_hecho && !r.eliminado_en && esServicioEntregable(r));
    return templates.adminDashboard({
      tipoPanel: 'todos', tabActiva: params.tab || 'agenda', cargaPorPestana: true,
      registros, realizados, eliminados: trabajos.filter(r => r.eliminado_en),
      agenda: { ...filtros, pagina: 1, paginas: 1, personas: agruparClientes(registros).length, trabajos: registros.length },
      resumen: { total: activos.length, agendados: pagados.length, personas_agendadas: agruparClientes(pagados).length,
        realizados: realizados.length, verificar: 0 },
    });
  };
  const { document, window: domWindow } = parseHTML(render('/admin' + location.search));
  class FormDataFixture {
    constructor(form) { this.pares = [...form.querySelectorAll('input[name]')].map(el => [el.name, el.value]); }
    [Symbol.iterator]() { return this.pares[Symbol.iterator](); }
  }
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/admin.js'), 'utf8'), {
    document, location, URL, URLSearchParams, AbortController, FormData: FormDataFixture, setTimeout, clearTimeout,
    setInterval() {},
    history: { replaceState: (_, __, u) => { location.search = new URL(u, location.href).search; },
      pushState: (_, __, u) => { location.search = new URL(u, location.href).search; } },
    window: { addEventListener() {}, scrollTo() {}, confirm: () => true },
    mostrarToast() {},
    DOMParser: class { parseFromString(html) { return parseHTML(html).document; } },
    fetch: async (url, opts) => {
      if (opts.method === 'POST') {
        const ref = url.split('/').pop(), r = trabajos.find(r => r.ref === ref);
        const accion = new URLSearchParams(opts.body).get('accion');
        const entregado = accion === 'marcar';
        if (url.includes('/trabajo/')) r.trabajo_hecho = entregado;
        else if (url.includes('/eliminar/')) r.eliminado_en = '2026-11-17';
        else if (url.includes('/restaurar/')) r.eliminado_en = null;
        return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ ok: true, realizado: entregado }) };
      }
      return { ok: true, text: async () => render(url) };
    },
  });
  const esperar = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setImmediate(r)); };
  const revisar = (personas, cantidad, total, entregados) => {
    for (const [selector, valor] of [
      ['#stat-personas', personas], ['#stat-agendados', cantidad], ['#stat-total', total],
      ['[data-tab=agenda] .tab-count', personas], ['[data-tab=realizados] .tab-count', entregados],
    ]) assert.equal(document.querySelector(selector).textContent, String(valor), selector);
  };
  const enviar = async (accion, ref) => {
    const form = document.querySelector('form[action="/admin/' + accion + '/' + ref + '"]');
    assert.ok(form, accion + '/' + ref);
    form.method = 'post';
    form.dispatchEvent(new domWindow.Event('submit', { bubbles: true, cancelable: true }));
    await esperar();
  };
  revisar(2, 2, 4, 0);
  document.querySelector('[data-adelanto]').click();
  await esperar();
  assert.equal(new URLSearchParams(location.search).get('adelanto'), 'si');
  assert.deepEqual([...document.querySelectorAll('#cuerpo-tabla tr[data-ref]')].map(r => r.dataset.ref), ['I']);
  revisar(2, 2, 4, 0);
  document.querySelector('[data-filtro=agendado]').click();
  await esperar();
  assert.equal(new URLSearchParams(location.search).get('adelanto'), 'si');
  assert.equal(document.querySelector('input[name=adelanto]').value, 'si');
  document.querySelector('[data-adelanto]').click();
  await esperar();
  assert.equal(new URLSearchParams(location.search).get('adelanto'), 'todos');
  document.querySelector('[data-filtro=agendado]').click();
  await esperar();
  assert.equal(document.querySelector('[data-ref=P]'), null, 'Agendados no mezcla el pendiente del comprador C');
  assert.ok(document.querySelector('[data-ref=A]'), 'El recargo confirmado mantiene su zona');
  assert.equal(document.querySelector('[data-ref=A] .trabajo-form'), null);
  await enviar('trabajo', 'S');
  revisar(1, 1, 3, 1);
  assert.ok(document.querySelector('[data-ref=A]'));
  await enviar('trabajo', 'I');
  revisar(0, 0, 2, 2);
  document.querySelector('[data-tab=realizados]').click();
  await esperar();
  await enviar('trabajo', 'I'); // Su formulario ahora solicita desmarcar.
  revisar(1, 1, 3, 1);
  document.querySelector('[data-tab=agenda]').click();
  await esperar();
  await enviar('eliminar', 'I');
  revisar(0, 0, 2, 1);
  document.querySelector('[data-tab=eliminados]').click();
  await esperar();
  await enviar('restaurar', 'I');
  revisar(1, 1, 3, 1);
  document.querySelector('[data-tab=agenda]').click();
  await esperar();
  assert.ok(document.querySelector('[data-ref=I]'));
  assert.equal(document.querySelector('[data-ref=P]'), null);
});
