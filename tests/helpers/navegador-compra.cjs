'use strict';

const vm = require('node:vm');
const fs = require('node:fs');
const { parseHTML } = require('linkedom');
const assert = require('node:assert/strict');

// DOM sin motor de navegación: ejecuta los archivos originales, no copias de
// sus funciones. Solo permite HTTP al servidor local de esta prueba.
async function navegador(url, html, request) {
  const { document, Event, CustomEvent, HTMLSelectElement } = parseHTML(html);
  // linkedom expone value solo como getter; un navegador permite seleccionarlo.
  Object.defineProperty(HTMLSelectElement.prototype, 'value', {
    configurable: true,
    get() { return (this.querySelector('option[selected]') || this.querySelector('option'))?.value || ''; },
    set(value) {
      for (const o of this.querySelectorAll('option')) o.removeAttribute('selected');
      for (const o of this.querySelectorAll('option')) if (o.value === String(value)) { o.setAttribute('selected', ''); break; }
    },
  });
  const storage = new Map();
  const pendientes = new Set();
  const solicitudes = [];
  const errores = [];
  const timers = new Set();
  const location = { origin: url, href: url + '/' };
  const context = vm.createContext({
    document, Event, CustomEvent, FormData, Blob, console,
    navigator: { language: 'es-CO' },
    addEventListener: (...args) => document.defaultView.addEventListener(...args),
    dispatchEvent: (...args) => document.defaultView.dispatchEvent(...args),
    location, innerWidth: 1024, innerHeight: 768,
    localStorage: {
      getItem: k => storage.get(k) || null,
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: k => storage.delete(k),
    },
    setTimeout(fn, ms) {
      const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
      timers.add(id);
      return id;
    },
    clearTimeout(id) { clearTimeout(id); timers.delete(id); },
    requestAnimationFrame() { return 0; },
    addEventListener() {}, removeEventListener() {},
    fetch(ruta, options) {
      assert.ok(typeof ruta === 'string' && ruta.startsWith('/api/'), 'Solicitud externa bloqueada: ' + ruta);
      const promesa = request(ruta, options).then(async res => {
        const data = await res.json();
        solicitudes.push({ ruta, options, status: res.status, data });
        return { ok: res.ok, status: res.status, json: async () => data };
      });
      pendientes.add(promesa);
      promesa.finally(() => pendientes.delete(promesa)).catch(e => errores.push(e));
      return promesa;
    },
  });
  vm.runInContext('window = globalThis;', context);
  // linkedom no implementa geometría; no hay layout ni navegación externa.
  document.defaultView.HTMLElement.prototype.getBoundingClientRect = () => ({
    left: 0, top: 0, width: 10, height: 10,
  });
  async function listo() {
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setImmediate(r));
      if (pendientes.size) await Promise.all([...pendientes]);
    }
    assert.deepEqual(errores, []);
  }
  for (const archivo of ['divisas.js', 'cart.js', 'wompi.js']) {
    vm.runInContext(fs.readFileSync(require.resolve('../../assets/' + archivo), 'utf8'), context, { filename: archivo });
  }
  await listo();
  function valor(id, value) {
    const el = document.getElementById(id);
    assert.ok(el, id);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function click(el) {
    if (typeof el === 'string') el = document.getElementById(el);
    assert.ok(el, 'Botón presente');
    el.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
  }
  return {
    document, solicitudes, location, listo, valor, click, divisas: context.FresaDivisas,
    divisa: codigo => context.FresaDivisas.establecer(codigo),
    carrito: () => JSON.parse(storage.get('fresa_carrito_v1') || '[]'),
    cerrar() { for (const id of timers) clearTimeout(id); },
  };
}

module.exports = { navegador };
