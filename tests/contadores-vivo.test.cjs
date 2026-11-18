'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');

const base = { personas_agendadas: 2, agendados: 3, total: 5, verificar: 1, realizados: 4,
  catalogo: 9, ingresos: 5000, comisiones: 1000, cobrado: 6000, ingresos_sin_desglose: 2 };
function respuesta(resumen = base, status = 200) {
  return { status, ok: status === 200, headers: { get: () => 'application/json' },
    json: async () => ({ ok: true, tipo: 'trabajo', resumen }) };
}
function diferida() { let resolver; const promesa = new Promise(r => { resolver = r; }); return { promesa, resolver }; }
function fixture() {
  const { document } = parseHTML('<html><body>' +
    ['personas', 'agendados', 'total', 'verificar', 'ingresos', 'comisiones', 'cobrado', 'sin-desglose']
      .map(id => '<div><span id="stat-' + id + '">99</span></div>').join('') +
    ['agenda', 'realizados', 'catalogo'].map(tab => '<a data-tab="' + tab + '"><span class="tab-count">99</span></a>').join('') +
    '<p id="contadores-estado" hidden></p><p id="agenda-cambios" hidden></p>' +
    '<form><input value="Borrador privado"></form><table><tr><td>Fila intacta</td></tr></table></body></html>');
  document.hidden = false;
  const eventos = {}, solicitudes = [], temporizadores = new Set();
  let responder = async () => respuesta(), tick, secuencia = 0;
  const window = { addEventListener(tipo, fn) { eventos[tipo] = fn; } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/admin-contadores.js'), 'utf8'), {
    window, document, location: { search: '?tab=agenda&tipo=trabajo&estado=agendado&adelanto=si' },
    URLSearchParams, AbortController,
    setInterval(fn, ms) { assert.equal(ms, 5000); tick = fn; },
    setTimeout(fn, ms) { assert.equal(ms, 10000); temporizadores.add(++secuencia); return secuencia; },
    clearTimeout(id) { temporizadores.delete(id); },
    fetch: async (url, opciones) => { solicitudes.push({ url, opciones }); return responder(url, opciones); },
  });
  return { document, eventos, solicitudes, temporizadores, tick, api: window.adminContadores,
    responder(fn) { responder = fn; }, valor(id) { return document.getElementById(id).textContent; } };
}

test('Los totales se actualizan solos sin descargar tablas, mover filas ni borrar borradores', async () => {
  const f = fixture(), form = f.document.querySelector('form'), tabla = f.document.querySelector('table');
  await f.tick();
  for (const [id, valor] of [['stat-personas', '2'], ['stat-agendados', '3'], ['stat-total', '5'],
    ['stat-verificar', '1'], ['stat-ingresos', '$5.000'], ['stat-comisiones', '$1.000'],
    ['stat-cobrado', '$6.000'], ['stat-sin-desglose', '2']]) assert.equal(f.valor(id), valor);
  assert.equal(f.document.querySelector('[data-tab=realizados] .tab-count').textContent, '4');
  assert.equal(f.document.querySelector('[data-tab=agenda] .tab-count').textContent, '2');
  assert.equal(f.document.querySelector('[data-tab=catalogo] .tab-count').textContent, '9');
  assert.equal(f.document.getElementById('stat-verificar').parentElement.classList.contains('destacado'), true);
  assert.equal(f.document.getElementById('agenda-cambios').hidden, false);
  assert.equal(f.document.querySelector('form'), form);
  assert.equal(f.document.querySelector('input').value, 'Borrador privado');
  assert.equal(f.document.querySelector('table'), tabla);
  assert.equal(f.solicitudes[0].url, '/admin/resumen?tipo=trabajo');
  assert.equal(f.solicitudes[0].opciones.cache, 'no-store');
  assert.equal(f.solicitudes[0].opciones.credentials, 'same-origin');
  assert.equal(f.temporizadores.size, 0);
});

test('Entregar consulta cifras reales enseguida y descarta consultas anteriores al guardado', async () => {
  const f = fixture(), vieja = diferida();
  f.responder(() => vieja.promesa);
  const primera = f.tick();
  f.api.pausar();
  f.responder(async () => respuesta({ ...base, personas_agendadas: 0, agendados: 0, verificar: 0 }));
  assert.equal(await f.api.actualizar(), true);
  assert.equal(f.valor('stat-personas'), '0');
  assert.equal(f.valor('stat-agendados'), '0');
  assert.equal(f.document.getElementById('stat-verificar').parentElement.classList.contains('destacado'), false);
  vieja.resolver(respuesta());
  await primera;
  assert.equal(f.valor('stat-agendados'), '0', 'Una respuesta vieja no restaura el trabajo ya entregado');
  assert.equal(f.document.getElementById('agenda-cambios').hidden, true, 'El propio guardado no exige renovar otra vez');
  assert.equal(f.temporizadores.size, 0);
  const n = f.solicitudes.length;
  await f.tick();
  assert.equal(f.solicitudes.length, n, 'No competir con un guardado en curso');
  f.api.reanudar();
});

test('El HTML lento no revierte un resumen más reciente y no se duplican peticiones simultáneas', async () => {
  const f = fixture(), turno = f.api.consulta(), lenta = diferida();
  f.responder(() => lenta.promesa);
  const a = f.tick(), b = f.eventos.focus(), c = f.eventos.online();
  assert.equal(f.solicitudes.length, 1);
  lenta.resolver(respuesta());
  await Promise.all([a, b, c]);
  assert.equal(f.api.aceptarDocumento({ contadoresTurno: turno }), false);
  assert.equal(f.api.aceptarDocumento({ contadoresTurno: f.api.consulta() }), true);
  assert.equal(f.temporizadores.size, 0);
});

test('Conexión, sesiones caducadas y datos incompletos mantienen el último valor confirmado con aviso', async () => {
  const f = fixture();
  await f.tick();
  f.responder(async () => { throw new Error('Sin conexión'); });
  await f.tick(); await f.tick();
  assert.equal(f.valor('stat-agendados'), '3');
  assert.match(f.valor('contadores-estado'), /últimos valores confirmados/);
  f.responder(async () => respuesta(null, 401));
  await f.tick();
  assert.match(f.valor('contadores-estado'), /Sesión caducada/);
  f.responder(async () => respuesta({ agendados: 0 }));
  await f.tick();
  assert.equal(f.valor('stat-agendados'), '3', 'Un resumen parcial no convierte otros contadores en cero');
  f.responder(async () => respuesta());
  await f.tick();
  assert.equal(f.document.getElementById('contadores-estado').hidden, true);
  f.document.hidden = true;
  const n = f.solicitudes.length;
  await f.tick();
  assert.equal(f.solicitudes.length, n);
  assert.equal(f.temporizadores.size, 0);
});
