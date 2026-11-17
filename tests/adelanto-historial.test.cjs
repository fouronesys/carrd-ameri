'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseHTML } = require('linkedom');
const { evento, servicio } = require('../lib/adelanto-historial');
const { panelAdelanto } = require('../lib/panel-adelanto');

const escapar = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

test('El evento usa una lista de campos permitidos y exige actor administrador', () => {
  const actor = { usuario: 'operador', usuario_id: 'u1', rol: 'admin', password: 'secreto', hash: 'secreto', cookie: 'secreto' };
  const nuevo = servicio('S1', { producto: 'Original', precio_cop: 200, contacto: 'privado', token: 'secreto' });
  const h = evento(null, nuevo, actor);
  assert.deepEqual(h.actor, { usuario: 'operador', usuario_id: 'u1', rol: 'admin' });
  assert.deepEqual(h.nuevo, { ref: 'S1', producto: 'Original' });
  assert.equal(h.accion, 'asignacion');
  assert.doesNotMatch(JSON.stringify(h), /secreto|privado|precio_cop/);
  assert.deepEqual(servicio('BORRADO', null), { ref: 'BORRADO', producto: '' });
  for (const a of [undefined, {}, { usuario: '  ', rol: 'admin' }, { usuario: 'asistente', rol: 'asistente' }]) {
    assert.throws(() => evento(null, nuevo, a), { status: 403 });
  }
});

test('El panel escapa autor, referencias y nombres históricos y no inventa cambios anteriores', () => {
  const opciones = { adelanto: { ref: 'A', adelanto_servicio_ref: 'LEGADO' }, actual: 'LEGADO', candidatos: [] };
  let d = parseHTML(panelAdelanto(opciones, escapar)).document;
  assert.match(d.body.textContent, /No hay cambios de vinculación registrados/);
  assert.equal(d.querySelectorAll('.historial li').length, 0);
  const peligro = '<img src=x onerror=alert(1)>';
  opciones.adelanto.adelanto_historial = [
    evento(null, servicio('S1' + peligro, { producto: peligro }), { usuario: peligro, usuario_id: peligro, rol: 'admin' }),
    evento(servicio('S1' + peligro), null, { usuario: 'administrador', rol: 'admin' }),
  ];
  d = parseHTML(panelAdelanto(opciones, escapar)).document;
  assert.equal(d.querySelectorAll('img,script,[onerror]').length, 0);
  assert.match(d.querySelector('.historial').textContent, /<img src=x onerror=alert\(1\)>/);
  assert.match(d.querySelector('.historial li').textContent, /Desvinculación/);
  assert.equal(d.querySelectorAll('time[datetime]').length, 2);
});
