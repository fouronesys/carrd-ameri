'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');
const { adminDashboard } = require('../lib/templates');

// Plantillas reales, datos sintéticos y fetch en memoria: sin DB, SMTP ni archivos de clientes.
function fixture() {
  const registros = [{
    ref: 'BORRADOR-A', cliente_id: 'CLIENTE-A', cliente_nombre: 'Cliente sintético',
    producto: 'Servicio sintético', estado: 'agendado', evidencia_notas: 'Nota guardada',
  }, {
    ref: 'BORRADOR-B', cliente_id: 'CLIENTE-B', producto: 'Otro servicio', estado: 'agendado',
  }];
  function render(url = '/admin') {
    const p = new URL(url, 'http://fixture').searchParams;
    return adminDashboard({
      tabActiva: p.get('tab') || 'agenda', cargaPorPestana: true, registros,
      agenda: { pagina: Number(p.get('pagina') || 1), paginas: 2, personas: 16, trabajos: 16,
        vista: 'vista-sintetica', buscar: p.get('buscar') || '', estado: p.get('estado') || '' },
    });
  }
  const { document, window: dom } = parseHTML(render());
  const valoresIniciales = new WeakMap([...document.querySelectorAll('input,textarea,select')]
    .map(c => [c, c.value]));
  const eventos = {}, solicitudes = [], mensajes = [], confirmaciones = [];
  const location = { pathname: '/admin', search: '', href: 'http://fixture/admin' };
  const estado = { aceptar: false, fallar: false, postOk: true, pausa: null };
  const historial = [];
  const cambiarUrl = (_, __, url) => {
    const u = new URL(url, location.href);
    location.search = u.search; location.href = u.href;
    historial.push(url);
  };
  document.defaultView.HTMLElement.prototype.scrollIntoView = function () {};
  // linkedom no implementa reset() ni FileList. El navegador real cubre ambos.
  document.defaultView.HTMLElement.prototype.reset = function () {
    this.querySelectorAll('textarea').forEach(c => { c.value = valoresIniciales.get(c) || ''; });
    this.querySelectorAll('input').forEach(c => { c.value = valoresIniciales.get(c) || ''; });
  };
  class Datos {
    constructor(form) {
      this.pares = [...form.querySelectorAll('input[name],textarea[name],select[name]')]
        .map(c => [c.name, c.value || '']);
    }
    [Symbol.iterator]() { return this.pares[Symbol.iterator](); }
    append(k, v) { this.pares.push([k, v]); }
  }
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/admin.js'), 'utf8'), {
    document, location, URL, URLSearchParams, FormData: Datos, setTimeout, clearTimeout, setInterval() {},
    history: { pushState: cambiarUrl, replaceState: cambiarUrl },
    window: {
      addEventListener: (tipo, fn) => { eventos[tipo] = fn; }, scrollTo() {},
      confirm: texto => { confirmaciones.push(texto); return estado.aceptar; },
    },
    DOMParser: class { parseFromString(html) { return parseHTML(html).document; } },
    mostrarToast: texto => mensajes.push(texto),
    fetch: async (url, opciones) => {
      solicitudes.push({ url, opciones });
      if (estado.pausa) await estado.pausa;
      if (estado.fallar) throw new Error('Sin conexión');
      if (opciones.method === 'POST') return {
        ok: estado.postOk, headers: { get: () => 'application/json' },
        json: async () => ({ ok: estado.postOk, error: 'No se pudo guardar' }),
      };
      return { ok: true, text: async () => render(url) };
    },
    // Cualquier intento de persistir datos del borrador debe fallar la prueba.
    localStorage: new Proxy({}, { get() { throw new Error('No persistir borradores'); } }),
    sessionStorage: new Proxy({}, { get() { throw new Error('No persistir borradores'); } }),
  });
  const fin = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
  function editar(selector = '.ev-form textarea', valor = 'Nota privada sin guardar', tipo = 'input') {
    const campo = document.querySelector(selector);
    if (campo.tagName === 'SELECT') campo.querySelector('option:last-child').selected = true;
    else campo.value = valor;
    campo.dispatchEvent(new dom.Event(tipo, { bubbles: true }));
    return campo;
  }
  async function click(selector) { document.querySelector(selector).click(); await fin(); }
  async function submit(selector, cancelado = false) {
    const form = document.querySelector(selector);
    form.method = 'post';
    const e = new dom.Event('submit', { bubbles: true, cancelable: true });
    if (cancelado) e.preventDefault();
    form.dispatchEvent(e);
    await fin();
    return e;
  }
  function salida() {
    const e = { prevented: false, preventDefault() { this.prevented = true; } };
    eventos.beforeunload(e);
    return e;
  }
  return { document, location, estado, eventos, solicitudes, mensajes, confirmaciones,
    historial, editar, click, submit, salida, fin };
}

for (const selector of [
  '[aria-label="Páginas de la agenda"] a', '[data-filtro=agendado]',
  '[data-tab=realizados]', '[data-agenda-renovar]',
]) {
  test('Cancelar protege notas y archivos al navegar: ' + selector, async () => {
    const f = fixture();
    const nota = f.editar();
    const archivo = f.editar('.ev-form input[type=file]', 'evidencia-sintetica.png', 'change');
    const url = f.location.search;
    await f.click(selector);
    assert.equal(f.solicitudes.length, 0);
    assert.equal(f.location.search, url);
    assert.equal(nota.isConnected, true);
    assert.equal(nota.value, 'Nota privada sin guardar');
    assert.equal(archivo.value, 'evidencia-sintetica.png');
    assert.equal(f.confirmaciones.length, 1);
  });
}

test('Buscar, enviar búsqueda y Atrás cancelados conservan borradores e historial visible', async () => {
  const f = fixture();
  f.editar();
  f.editar('#buscador', 'Cliente');
  await new Promise(r => setTimeout(r, 350));
  await f.fin();
  assert.equal(f.solicitudes.length, 0);
  await f.submit('#agenda-busqueda');
  assert.equal(f.solicitudes.length, 0);
  const url = f.location.search;
  f.location.search = '?tab=realizados';
  await f.eventos.popstate();
  assert.equal(f.location.search, url);
  assert.equal(f.document.querySelector('.ev-form textarea').value, 'Nota privada sin guardar');
  assert.equal(f.salida().prevented, true, 'La salida nativa también pide confirmación');
});

test('Aceptar descarte navega solo por GET y nunca envía evidencia', async () => {
  const f = fixture();
  f.editar();
  f.editar('.ev-form input[type=file]', 'evidencia.png', 'change');
  f.estado.aceptar = true;
  await f.click('[aria-label="Páginas de la agenda"] a');
  assert.equal(f.solicitudes.length, 1);
  assert.equal(f.solicitudes[0].opciones.method, undefined);
  assert.equal(f.document.querySelector('.ev-form textarea').value, 'Nota guardada');
  assert.equal(f.salida().prevented, false);
});

test('Si falla la navegación aceptada se conservan las notas y los archivos', async () => {
  const f = fixture();
  f.editar();
  const archivo = f.editar('.ev-form input[type=file]', 'evidencia.png', 'change');
  f.estado.aceptar = true;
  f.estado.fallar = true;
  await f.click('[data-tab=realizados]');
  assert.equal(archivo.isConnected, true);
  assert.equal(archivo.value, 'evidencia.png');
  assert.equal(f.salida().prevented, true);
});

test('Una edición nueva invalida una navegación que aún está cargando', async () => {
  const f = fixture();
  let terminar;
  f.estado.pausa = new Promise(r => { terminar = r; });
  await f.click('[data-tab=realizados]');
  const nota = f.editar();
  terminar();
  await f.fin();
  assert.equal(nota.isConnected, true);
  assert.equal(f.document.querySelector('.admin-sec.activo').dataset.sec, 'agenda');
  assert.equal(f.salida().prevented, true);
});

for (const selector of [
  '.edit-form input[name=producto]', '.edit-form textarea[name=info_extra]',
  '.edit-form select[name=estado]', '.ev-form input[type=file]',
]) {
  test('Protege edición, servicio adicional y archivos incluso sin notas: ' + selector, async () => {
    const f = fixture();
    f.editar(selector, 'cambio', 'change');
    assert.equal(f.salida().prevented, true);
    await f.click('[data-tab=realizados]');
    assert.equal(f.solicitudes.length, 0);
  });
}

test('Cerrar sesión permite cancelar o salir sin AJAX, sin reenvíos y sin borradores recuperables', async () => {
  const f = fixture();
  const nota = f.editar();
  const archivo = f.editar('.ev-form input[type=file]', 'evidencia.png', 'change');
  assert.equal((await f.submit('form[action="/admin/logout"]')).defaultPrevented, true);
  assert.equal(nota.value, 'Nota privada sin guardar');
  f.estado.aceptar = true;
  assert.equal((await f.submit('form[action="/admin/logout"]')).defaultPrevented, false);
  assert.equal(nota.value, 'Nota guardada');
  assert.equal(archivo.value, '');
  assert.equal(f.salida().prevented, false);
  f.eventos.pageshow();
  assert.equal(f.salida().prevented, false);
  assert.equal(f.solicitudes.length, 0);
});

test('No advertir sin ediciones; limpiar al salir evita recuperar borradores con Atrás', () => {
  const f = fixture();
  assert.equal(f.salida().prevented, false);
  const nota = f.editar();
  f.eventos.pagehide();
  f.eventos.pageshow();
  assert.equal(nota.value, 'Nota guardada');
  assert.equal(f.salida().prevented, false);
});

test('Un envío cancelado o fallido no borra el borrador ni ejecuta otras acciones', async () => {
  const f = fixture();
  const nota = f.editar();
  await f.submit('.ev-form', true);
  assert.equal(f.solicitudes.length, 0);
  f.estado.postOk = false;
  await f.submit('.ev-form');
  assert.equal(f.solicitudes.length, 1);
  assert.equal(nota.value, 'Nota privada sin guardar');
  assert.equal(f.salida().prevented, true);
});

test('Guardar una fila no destruye el borrador de otra sin consentimiento', async () => {
  const f = fixture();
  const formularios = f.document.querySelectorAll('[data-sec=agenda] .ev-form');
  const otro = formularios[1];
  const nota = f.editar('[data-sec=agenda] form[action="/admin/evidencia/BORRADOR-B"] textarea');
  f.editar();
  await f.submit('.ev-form');
  assert.equal(f.solicitudes.filter(s => s.opciones.method === 'POST').length, 1);
  assert.equal(otro.isConnected, true);
  assert.equal(nota.value, 'Nota privada sin guardar');
  assert.equal(formularios[0].hasAttribute('data-agenda-editado'), false, 'Solo se limpió el enviado');
  assert.equal(otro.hasAttribute('data-agenda-editado'), true);
  assert.equal(f.confirmaciones.length, 1);
});

test('Lo escrito durante un guardado no se da por enviado ni se descarta sin preguntar', async () => {
  const f = fixture();
  let terminar;
  f.estado.pausa = new Promise(r => { terminar = r; });
  f.editar();
  await f.submit('.ev-form');
  const nota = f.editar('.ev-form textarea', 'Nota escrita después del envío');
  terminar();
  await f.fin();
  assert.equal(nota.isConnected, true);
  assert.equal(nota.value, 'Nota escrita después del envío');
  assert.equal(f.salida().prevented, true);
  assert.equal(f.solicitudes.filter(s => s.opciones.method === 'POST').length, 1);
});
