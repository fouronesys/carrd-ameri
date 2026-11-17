'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');

function entorno(reducido = false) {
  const { document, window } = parseHTML('<html><body><button><b>Tocar</b></button><input><button disabled>No</button></body></html>');
  const timers = [];
  vm.runInNewContext(fs.readFileSync('assets/interacciones.js', 'utf8'), {
    document,
    window: { PointerEvent: function () {}, matchMedia: () => ({ matches: reducido }),
      setTimeout: (fn, ms) => timers.push({ fn, ms }) },
  });
  function evento(tipo, el, extra = {}) {
    const e = new window.Event(tipo, { bubbles: true, cancelable: true });
    Object.assign(e, { pointerId: 1, pointerType: 'touch', clientX: 40, clientY: 60 }, extra);
    el.dispatchEvent(e);
    assert.equal(e.defaultPrevented, false, 'Nunca intercepta la acción del botón');
  }
  return { document, timers, evento };
}

test('El toque crea un efecto accesible y temporal sin modificar el botón', () => {
  const { document, timers, evento } = entorno();
  const target = document.querySelector('b');
  evento('pointerdown', target);
  evento('pointerup', target);
  assert.equal(document.querySelector('.fs-toque').getAttribute('aria-hidden'), 'true');
  assert.equal(document.querySelector('button').innerHTML, '<b>Tocar</b>');
  assert.equal(timers[0].ms, 450);
  timers[0].fn();
  assert.equal(document.querySelector('.fs-toque'), null);
});

test('No anima al desplazar, cancelar, usar ratón ni tocar campos o botones desactivados', () => {
  const { document, evento } = entorno();
  const button = document.querySelector('button');
  for (const el of [document.querySelector('input'), document.querySelector('[disabled]')]) {
    evento('pointerdown', el); evento('pointerup', el);
  }
  evento('pointerdown', button, { pointerType: 'mouse' });
  evento('pointerup', button, { pointerType: 'mouse' });
  evento('pointerdown', button);
  evento('pointermove', button, { clientY: 90 });
  evento('pointerup', button);
  evento('pointerdown', button); evento('pointercancel', button); evento('pointerup', button);
  assert.equal(document.querySelectorAll('.fs-toque').length, 0);
});

test('Funciona en controles añadidos dinámicamente y respeta movimiento reducido', () => {
  const { document, timers, evento } = entorno(true);
  const link = document.createElement('a');
  link.href = '#catalogo';
  document.body.appendChild(link);
  for (let i = 0; i < 8; i++) {
    evento('pointerdown', link); evento('pointerup', link);
  }
  assert.equal(document.querySelectorAll('.fs-toque').length, 4);
  assert.ok(timers.every(t => t.ms === 120));
  timers.forEach(t => t.fn());
  assert.equal(document.querySelectorAll('.fs-toque').length, 0);
});
