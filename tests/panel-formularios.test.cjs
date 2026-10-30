'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { parseHTML } = require('linkedom');

for (const escenario of ['redirect', 'multipart', 'error', 'cancelado']) {
  test('Formulario general del panel: ' + escenario, async () => {
    const html = '<nav class="admin-nav"></nav><section class="admin-sec activo" data-sec="promos">' +
      '<form method="post" action="/admin/promo"><input name="porcentaje" value="10">' +
      '<button type="submit">Guardar</button></form></section>';
    const { document, window } = parseHTML(html);
    const solicitudes = [], mensajes = [], posiciones = [];
    class Datos {
      constructor() { this.pares = [['porcentaje', '10']]; }
      [Symbol.iterator]() { return this.pares[Symbol.iterator](); }
      append(k, v) { this.pares.push([k, v]); }
    }
    vm.runInNewContext(fs.readFileSync(require.resolve('../assets/admin.js'), 'utf8'), {
      document, URL, URLSearchParams, FormData: Datos, setTimeout, clearTimeout,
      location: { href: 'http://fixture/admin?tab=promos', search: '?tab=promos' },
      history: { replaceState() {} },
      window: { scrollY: 470, scrollTo: (x, y) => posiciones.push(y), addEventListener() {} },
      DOMParser: class { parseFromString(s) { return parseHTML(s).document; } },
      mostrarToast: m => mensajes.push(m),
      fetch: async (url, opciones) => {
        solicitudes.push({ url, opciones });
        return {
          ok: escenario !== 'error', redirected: true,
          headers: { get: () => 'text/html' },
          text: async () => escenario === 'error'
            ? '<html><body>Datos incompletos</body></html>' : html,
        };
      },
    });
    const form = document.querySelector('form');
    form.method = 'post';
    form.enctype = escenario === 'multipart' ? 'multipart/form-data' : 'application/x-www-form-urlencoded';
    // linkedom no implementa este método visual.
    document.defaultView.HTMLElement.prototype.scrollIntoView = function () {};
    const evento = new window.Event('submit', { bubbles: true, cancelable: true });
    if (escenario === 'cancelado') evento.preventDefault();
    form.dispatchEvent(evento);
    for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r));
    assert.ok(evento.defaultPrevented);
    if (escenario === 'cancelado') return assert.equal(solicitudes.length, 0);
    assert.equal(solicitudes[0].opciones.method, 'POST');
    assert.ok(solicitudes[0].opciones.body instanceof (escenario === 'multipart' ? Datos : URLSearchParams));
    if (escenario === 'error') {
      assert.equal(document.querySelector('.form-error').textContent, 'Datos incompletos');
      assert.equal(document.querySelector('input').value, '10');
      assert.equal(document.querySelector('button').disabled, false);
      assert.equal(solicitudes.length, 1);
    } else {
      assert.equal(solicitudes[1].url, '/admin?tab=promos&tipo=trabajo');
      assert.deepEqual(mensajes, ['Cambio guardado']);
      assert.deepEqual(posiciones, [470]);
      assert.equal(document.querySelector('.admin-sec.activo').dataset.sec, 'promos');
    }
  });
}
