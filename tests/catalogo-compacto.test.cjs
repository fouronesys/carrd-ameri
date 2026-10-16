'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { catalogoDOM } = require('./helpers/catalogo-dom.cjs');

for (const nativePopover of [false, true]) {
  test(`Filtros cerrados por defecto, cierre y foco (${nativePopover ? 'capa nativa' : 'compatibilidad'})`, () => {
    const ui = catalogoDOM({ nativePopover });
    const p = ui.panel('hechizos'), popup = p.querySelector('.fsb-popover'), toggle = p.querySelector('.fsb-trigger');
    assert.equal(popup.hidden, true);
    assert.equal(toggle.getAttribute('aria-controls'), popup.id);
    assert.equal(p.querySelector('.fsb-count').textContent, '83 hechizos');
    assert.equal(ui.panel('lecturas').querySelector('.fsb-count').textContent, '23 lecturas');
    ui.click(toggle);
    assert.equal(popup.hidden, false);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(ui.document.activeElement, p.querySelector('.fsb-c'));
    assert.equal(popup.style.width, '350px');
    if (nativePopover) assert.ok(popup.hasAttribute('data-test-open'));
    ui.key(p.querySelector('.fsb-c'), 'Escape');
    assert.equal(popup.hidden, true);
    assert.equal(ui.document.activeElement, toggle);
    ui.click(toggle);
    ui.outside(ui.document.body);
    assert.equal(popup.hidden, true);
    ui.click(toggle);
    ui.click(p.querySelector('.fsb-close'));
    assert.equal(popup.hidden, true);
    ui.click(toggle);
    ui.document.body.focus();
    assert.equal(popup.hidden, true);
    ui.click(toggle);
    ui.hashchange();
    assert.equal(popup.hidden, true);
    assert.equal(ui.listening('hashchange'), 0);
    assert.equal(ui.listening('resize'), 0);
  });
}

test('Etiquetas eliminables, presupuesto validado, monedas y restablecimiento', () => {
  const ui = catalogoDOM(), p = ui.panel('hechizos'), toggle = p.querySelector('.fsb-trigger');
  ui.click(toggle);
  ui.set(p.querySelector('.fsb-c'), 'Vinculares');
  assert.equal(p.querySelectorAll('.fsb-chip').length, 1);
  ui.set(p.querySelector('.fsb-m'), '50.000');
  ui.set(p.querySelector('.fsb-s'), 'asc');
  assert.equal(p.querySelector('.fsb-badge').textContent, '3');
  assert.equal(p.querySelector('.fsb-badge').hidden, false);
  ui.click(p.querySelector('[aria-label="Quitar presupuesto"]'));
  assert.equal(p.querySelector('.fsb-m').value, '');
  assert.equal(p.querySelectorAll('.fsb-chip').length, 2);
  ui.set(p.querySelector('.fsb-cur'), 'usd');
  ui.set(p.querySelector('.fsb-m'), '25,50');
  assert.equal(p.querySelector('.fsb-m').getAttribute('aria-invalid'), 'false');
  assert.match(p.querySelector('.fsb-chips').textContent, /25,5 USD/);
  assert.equal(p.querySelector('.fsb-badge').textContent, '4');
  for (const bad of ['abc', '-1', '$', '25.555']) {
    ui.set(p.querySelector('.fsb-m'), bad);
    assert.equal(p.querySelector('.fsb-budget-error').hidden, false);
    ui.click(p.querySelector('.fsb-apply'));
    assert.equal(p.querySelector('.fsb-popover').hidden, false);
    assert.equal(ui.document.activeElement, p.querySelector('.fsb-m'));
  }
  ui.click(p.querySelector('.fsb-restore'));
  assert.equal(p.querySelector('.fsb-popover').hidden, false);
  assert.equal(p.querySelector('.fsb-chips').hidden, true);
  assert.equal(p.querySelector('.fsb-reset').hidden, true);
  assert.equal(p.querySelector('.fsb-budget-error').hidden, true);
  assert.equal(p.querySelector('.fsb-cur').value, 'cop');
  assert.equal(p.querySelector('.fsb-s').value, 'orig');
  ui.click(p.querySelector('.fsb-apply'));
  assert.equal(p.querySelector('.fsb-popover').hidden, true);
  assert.equal(ui.document.activeElement, toggle);
});

test('La búsqueda conserva los nodos, el orden original y los botones de compra', () => {
  const ui = catalogoDOM(), sec = ui.section('hechizos'), p = ui.panel('hechizos');
  const original = [...sec.querySelectorAll('span.p')].filter(n => /\$\s*\d/.test(n.textContent));
  const positions = original.map(n => ({ n, parent: n.parentNode, next: n.nextSibling }));
  const first = original[0], button = ui.document.createElement('button');
  button.className = 'wm-pay-btn';
  let clicks = 0;
  button.addEventListener('click', () => clicks++);
  first.appendChild(button);
  ui.set(p.querySelector('.fsb-q'), 'LIMPIEZA VINCULO');
  assert.ok(sec.querySelectorAll('.fsb-item').length > 0);
  assert.ok(sec.querySelector('.fsb-results').contains(first));
  assert.equal(first.querySelector('button'), button);
  ui.click(button);
  assert.equal(clicks, 1);
  ui.set(p.querySelector('.fsb-q'), 'zzzinexistentezzz');
  assert.equal(sec.querySelector('.fsb-empty').hidden, false);
  assert.equal(sec.querySelectorAll('.fsb-item').length, 0);
  ui.click(sec.querySelector('.fsb-reset-2'));
  assert.equal(sec.classList.contains('fsb-activo'), false);
  assert.equal(sec.querySelector('.fsb-empty').hidden, true);
  for (const { n, parent, next } of positions) {
    assert.equal(n.parentNode, parent);
    assert.equal(n.nextSibling, next);
  }
  assert.deepEqual([...sec.querySelectorAll('span.p')].filter(n => /\$\s*\d/.test(n.textContent)), original);
  assert.equal(ui.document.createTreeWalker(sec, 128).nextNode(), null, 'No quedan marcadores de búsqueda');
  ui.click(button);
  assert.equal(clicks, 2);
});

test('Hechizos y lecturas conservan filtros independientes y admiten servicios dinámicos', () => {
  const ui = catalogoDOM(), hechizos = ui.panel('hechizos'), lecturas = ui.panel('lecturas');
  ui.set(hechizos.querySelector('.fsb-q'), 'amor');
  ui.set(lecturas.querySelector('.fsb-q'), 'tiempo');
  const hCount = hechizos.querySelector('.fsb-count').textContent;
  ui.click(lecturas.querySelector('.fsb-reset'));
  assert.equal(hechizos.querySelector('.fsb-q').value, 'amor');
  assert.equal(hechizos.querySelector('.fsb-count').textContent, hCount);
  assert.equal(lecturas.querySelector('.fsb-count').textContent, '23 lecturas');
  ui.click(hechizos.querySelector('.fsb-reset'));
  const sec = ui.section('hechizos'), node = ui.document.createElement('span');
  node.className = 'p catalogo-servicio';
  node.innerHTML = '<strong>Servicio dinámico exclusivo</strong><br>$12.000 (5 USD)<br>Descripción de muestra';
  sec.querySelector('span.p').parentNode.appendChild(node);
  ui.set(hechizos.querySelector('.fsb-q'), 'dinamico exclusivo');
  assert.equal(sec.querySelectorAll('.fsb-item').length, 1);
  assert.equal(sec.querySelector('.fsb-item > span.p'), node);
  assert.equal(hechizos.querySelector('.fsb-count').textContent, '1 de 84 hechizos');
  ui.click(hechizos.querySelector('.fsb-reset'));
  assert.equal(hechizos.querySelector('.fsb-count').textContent, '84 hechizos');
});
