'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');
const templates = require('../lib/templates');

// Sin servidor, base de datos, credenciales ni peticiones a clientes reales.
function fixture() {
  const html = templates.adminDashboard({
    tabActiva: 'agenda', cargaPorPestana: true,
    registros: [
      { ref: 'PRUEBA-1', cliente_id: 'FICTICIO-1', cliente_nombre: 'Persona ficticia uno', estado: 'agendado', producto: 'Prueba' },
      { ref: 'PRUEBA-2', cliente_id: 'FICTICIO-2', cliente_nombre: 'Persona ficticia dos', estado: 'agendado', producto: 'Prueba' },
    ],
    agenda: { vista: 'vista-aislada', pagina: 2, paginas: 3, buscar: 'prueba', estado: 'todos', personas: 31, trabajos: 31 },
  });
  const { document, Event } = parseHTML(html);
  const eventos = {}, temporizadores = new Map(), solicitudes = [];
  let comprobar, secuencia = 0;
  let responder = async () => { throw new TypeError('sin conexión'); };
  const location = { href: 'http://fixture/admin', search: '?tab=agenda&pagina=2', pathname: '/admin' };
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/admin.js'), 'utf8'), {
    document, location, URL, URLSearchParams, AbortController,
    setInterval(fn, ms) { assert.equal(ms, 30000); comprobar = fn; },
    setTimeout(fn, ms) { assert.equal(ms, 10000); temporizadores.set(++secuencia, fn); return secuencia; },
    clearTimeout(id) { temporizadores.delete(id); },
    history: { replaceState() {}, pushState() { assert.fail('No debe cambiar el historial'); } },
    window: { addEventListener(tipo, fn) { eventos[tipo] = fn; }, scrollTo() { assert.fail('No debe desplazar la página'); } },
    fetch: async (url, opciones) => {
      solicitudes.push({ url, opciones });
      assert.ok(url.includes('comprobar_agenda=1'), 'Solo se permite la comprobación aislada');
      return responder(url, opciones);
    },
  });
  const formulario = document.querySelector('.edit-row');
  formulario.style.display = 'table-row';
  const campo = formulario.querySelector('input[name]');
  campo.value = 'Borrador sin guardar';
  const tabla = document.querySelector('#cuerpo-tabla');
  const filas = [...tabla.children];
  const urlInicial = location.search;
  return {
    document, eventos, temporizadores, solicitudes, comprobar, Event,
    responder(fn) { responder = fn; },
    indicador() { return document.getElementById('agenda-comprobacion'); },
    intacta() {
      assert.equal(document.querySelector('#cuerpo-tabla'), tabla);
      assert.deepEqual([...tabla.children], filas);
      assert.equal(formulario.style.display, 'table-row');
      assert.equal(campo.value, 'Borrador sin guardar');
      assert.equal(location.search, urlInicial);
      assert.equal(temporizadores.size, 0, 'Cada petición libera su temporizador');
    },
  };
}

function respuesta(datos = { cambios: false, caducada: false }, status = 200, tipo = 'application/json') {
  return { ok: status === 200, status, headers: { get: () => tipo }, json: async () => datos };
}

test('Fallos prolongados avisan discretamente; recuperar conexión conserva edición, recorrido y novedades', async () => {
  const f = fixture();
  assert.equal(f.indicador().hidden, true);
  for (let i = 0; i < 2; i++) {
    await f.comprobar();
    assert.equal(f.indicador().hidden, true, 'Un fallo transitorio no interrumpe');
  }
  await f.comprobar();
  assert.equal(f.indicador().hidden, false);
  assert.match(f.indicador().textContent, /No se pudo conectar/);
  assert.equal(f.indicador().getAttribute('aria-live'), 'polite');
  f.intacta();
  f.responder(async () => respuesta({ cambios: true, caducada: false }));
  await f.eventos.online();
  assert.equal(f.indicador().hidden, true);
  assert.equal(f.document.getElementById('agenda-cambios').hidden, false);
  f.responder(async () => { throw new TypeError('otra desconexión'); });
  await f.comprobar();
  assert.equal(f.indicador().hidden, true, 'Recuperar reinicia el contador de fallos');
  assert.equal(f.document.getElementById('agenda-cambios').hidden, false, 'No borra novedades detectadas');
  f.intacta();
  for (const { opciones } of f.solicitudes) {
    assert.equal(opciones.credentials, 'same-origin');
    assert.equal(opciones.cache, 'no-store');
  }
});

test('La sesión caducada se distingue de conexión y de recorrido caducado, sin redirigir', async () => {
  for (const status of [401, 403]) {
    const f = fixture();
    f.responder(async () => respuesta(null, status));
    await f.comprobar();
    assert.equal(f.indicador().hidden, false);
    assert.match(f.indicador().textContent, /Tu sesión caducó/);
    assert.match(f.indicador().textContent, /otra pestaña/);
    f.responder(async () => { throw new TypeError('sin conexión'); });
    await f.comprobar();
    assert.match(f.indicador().textContent, /Tu sesión caducó/);
    f.responder(async () => respuesta({ cambios: true, caducada: true }));
    await f.eventos.focus();
    assert.equal(f.indicador().hidden, true);
    assert.match(f.document.getElementById('agenda-cambios').textContent, /recorrido caducó/);
    f.intacta();
  }
});

test('Errores de servidor, HTML y respuestas inválidas no se confunden con recuperación', async () => {
  const f = fixture();
  for (const r of [
    respuesta(null, 503),
    respuesta(null, 200, 'text/html'),
    respuesta({ error: 'respuesta incompleta' }),
    respuesta(null),
    { ...respuesta(), json: async () => { throw new SyntaxError('JSON inválido'); } },
  ]) {
    f.responder(async () => r);
    await f.comprobar();
  }
  assert.equal(f.indicador().hidden, false);
  assert.match(f.indicador().textContent, /en este momento/);
  assert.doesNotMatch(f.indicador().textContent, /sesión caducó/);
  f.responder(async () => respuesta());
  await f.comprobar();
  assert.equal(f.indicador().hidden, true);
  f.intacta();
});

test('Una petición bloqueada caduca, evita solapamientos y permite el siguiente intento', async () => {
  const f = fixture();
  f.responder((_, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
  }));
  for (let i = 0; i < 3; i++) {
    const pendiente = f.comprobar();
    await f.eventos.focus();
    assert.equal(f.solicitudes.length, i + 1, 'No duplica peticiones pendientes');
    [...f.temporizadores.values()][0]();
    await pendiente;
  }
  assert.match(f.indicador().textContent, /No se pudo conectar/);
  f.responder(async () => respuesta());
  await f.comprobar();
  assert.equal(f.indicador().hidden, true);
  f.intacta();
});

test('Ignora respuestas de una vista reemplazada y pausa fuera de la agenda o en segundo plano', async () => {
  const f = fixture();
  let resolver;
  f.responder(() => new Promise(resolve => { resolver = resolve; }));
  const pendiente = f.comprobar();
  f.document.querySelector('#agenda-busqueda').dataset.url += '&vista=otra';
  resolver(respuesta(null, 401));
  await pendiente;
  assert.equal(f.indicador().hidden, true, 'Una respuesta antigua no caduca la vista nueva');
  f.document.hidden = true;
  await f.comprobar();
  assert.equal(f.solicitudes.length, 1);
  f.document.hidden = false;
  f.document.querySelector('[data-sec=agenda]').classList.remove('activo');
  f.document.querySelector('[data-sec=realizados]').classList.add('activo');
  await f.comprobar();
  assert.equal(f.solicitudes.length, 1);
  f.intacta();
});
