'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');
const { versionarScripts } = require('../lib/version-assets');

test('Los scripts se versionan por su contenido, sin alterar las fichas', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const versionado = versionarScripts(html, process.cwd());
  assert.match(versionado, /src="\/assets\/wompi.js\?v=[0-9a-f]{16}"/);
  assert.equal(versionarScripts(versionado, process.cwd()), versionado);
  assert.equal((versionado.match(/class="p"/g) || []).length, (html.match(/class="p"/g) || []).length);
});

test('Una cotización bloqueada vence con un error recuperable, sin crear cobros', async () => {
  const { window, document } = parseHTML('<html><body></body></html>');
  let timeout, peticiones = [];
  window.localStorage = { getItem: () => 'COP', setItem() {} };
  const context = vm.createContext({
    window, document, console, navigator: { language: 'es-CO' }, Intl, Date, Promise,
    AbortController, CustomEvent: window.CustomEvent, MutationObserver: window.MutationObserver,
    setTimeout: (fn, ms) => { if (ms === 15000) timeout = fn; return 1; }, clearTimeout() {},
    fetch: url => { peticiones.push(url); return new Promise(() => {}); },
  });
  vm.runInContext(fs.readFileSync('assets/divisas.js', 'utf8'), context);
  const p = window.FresaDivisas.cotizar({ divisa: 'COP', items: [] });
  timeout();
  await assert.rejects(p, /tardó demasiado.*Volver a calcular/);
  assert.ok(peticiones.every(p => p === '/api/divisas' || p === '/api/cotizacion'));
});
