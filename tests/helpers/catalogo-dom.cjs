'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');

// Executes production scripts with the original catalog; no HTTP, DB or payments.
function catalogoDOM({ nativePopover = false, html } = {}) {
  const { window, document, Event, HTMLElement, HTMLSelectElement } = parseHTML(
    html || fs.readFileSync(require.resolve('../../index.html'), 'utf8'));
  const listeners = new Map();
  let focused = null;
  // Browser semantics missing from linkedom, not application replacements.
  Object.defineProperty(HTMLSelectElement.prototype, 'value', {
    configurable: true,
    get() { const o = this.querySelector('option[selected]') || this.querySelector('option'); return o ? o.value : ''; },
    set(value) {
      for (const o of this.querySelectorAll('option')) o.removeAttribute('selected');
      for (const o of this.querySelectorAll('option')) if (o.value === String(value)) { o.setAttribute('selected', ''); break; }
    },
  });
  Object.defineProperty(document, 'activeElement', { configurable: true, get: () => focused });
  HTMLElement.prototype.focus = function () {
    focused = this;
    this.dispatchEvent(new Event('focusin', { bubbles: true }));
  };
  HTMLElement.prototype.getBoundingClientRect = function () {
    return { left: 20, right: 370, top: 100, bottom: 148, width: 350, height: this.classList.contains('fsb-popover') ? 430 : 48 };
  };
  HTMLElement.prototype.showPopover = nativePopover ? function () { this.setAttribute('data-test-open', ''); } : undefined;
  HTMLElement.prototype.hidePopover = nativePopover ? function () { this.removeAttribute('data-test-open'); } : undefined;
  const context = vm.createContext({
    document, Event, console, innerWidth: 390, innerHeight: 700,
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
    },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    fetch() { throw new Error('Network access is forbidden in catalog tests'); },
  });
  vm.runInContext('window = globalThis;', context);
  for (const name of ['catalogo-filtros.js', 'catalogo-buscador.js']) {
    vm.runInContext(fs.readFileSync(require.resolve('../../assets/' + name), 'utf8'), context, { filename: name });
  }
  function event(target, type, properties = {}) {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(e, properties);
    target.dispatchEvent(e);
  }
  return {
    document, window,
    panel: tipo => document.querySelector('#' + tipo + '-section .fsb-panel'),
    section: tipo => document.getElementById(tipo + '-section'),
    click: target => event(target, 'click'),
    set(target, value) { target.value = value; event(target, target.tagName === 'SELECT' ? 'change' : 'input'); },
    key: (target, key) => event(target, 'keydown', { key }),
    outside: target => event(target, 'pointerdown'),
    hashchange() { for (const fn of listeners.get('hashchange') || []) fn(); },
    listening: name => listeners.get(name)?.size || 0,
  };
}
module.exports = { catalogoDOM };
