'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { parseHTML } = require('linkedom');
const { agruparClientes, claveCliente } = require('../lib/agenda-clientes');
const templates = require('../lib/templates');

test('Cuenta al comprador, agrupa cuentas entre pedidos e invitados por pedido, sin fusionar homónimos', () => {
  const registros = [
    { ref: '1', cliente_id: ' C1 ', pedido_ref: 'P1', cliente_nombre: 'Igual', objetivo_nombre: 'Persona A' },
    { ref: '2', cliente_id: 'C1', pedido_ref: 'P2', objetivo_nombre: 'Persona B' },
    { ref: '3', pedido_ref: 'P3', cliente_nombre: 'Igual' },
    { ref: '4', pedido_ref: 'P3', contacto: '' },
    { ref: '5', cliente_nombre: 'Igual' }, { ref: '6', cliente_nombre: 'Igual' },
    { ref: '7', cliente_id: 'P3' },
  ];
  const grupos = agruparClientes(registros);
  assert.deepEqual(grupos.map(g => g.registros.map(r => r.ref)), [['1', '2'], ['3', '4'], ['5'], ['6'], ['7']]);
  assert.notEqual(claveCliente(registros[2]), claveCliente(registros[6]));
});

let fixture, servidor, url, cookie;
before(async () => {
  process.env.ADMIN_PASSWORD = 'isolated-admin-test';
  process.env.ASSISTANT_PASSWORD = 'isolated-assistant-test';
  process.env.SESSION_SECRET = 'isolated-session-test-not-a-live-secret';
  process.env.NODE_ENV = 'test';
  fixture = require('./helpers/admin-fixture.cjs');
  servidor = fixture.app.listen(0, '127.0.0.1');
  await new Promise(resolve => servidor.once('listening', resolve));
  url = 'http://127.0.0.1:' + servidor.address().port;
  const login = await fetch(url + '/admin/login', {
    method: 'POST', redirect: 'manual', headers: { Origin: url }, body: new URLSearchParams({ password: 'isolated-admin-test' }),
  });
  assert.equal(login.status, 302);
  cookie = login.headers.get('set-cookie').split(';')[0];
});
after(async () => {
  servidor.closeAllConnections();
  await new Promise(resolve => servidor.close(resolve));
});
const pagina = async () => ({ window: parseHTML(await (await fetch(url + '/admin', { headers: { cookie } })).text()) });

test('Panel agrupado: conserva cada referencia, estados, edición, evidencia y permisos por rol', () => {
  const registros = [
    { ref: 'ESC-1', cliente_id: 'cliente', cliente_nombre: '<script>mal()</script>', producto: 'Servicio A', estado: 'agendado' },
    { ref: 'ESC-2', cliente_id: 'cliente', cliente_nombre: '<script>mal()</script>', producto: 'Servicio B', estado: 'agendado' },
  ];
  for (const rol of ['admin', 'asistente']) {
    const dom = { window: parseHTML(templates.adminDashboard({ registros, rol })) };
    const d = dom.window.document;
    assert.equal(d.querySelector('#stat-personas').textContent, '1');
    assert.equal(d.querySelector('#stat-agendados').textContent, '2');
    assert.equal(d.querySelectorAll('[data-cliente-grupo]').length, 1);
    assert.equal(d.querySelectorAll('#cuerpo-tabla tr[data-ref]').length, 2);
    assert.equal(d.querySelector('.cliente-cabecera strong').textContent, '<script>mal()</script>');
    assert.equal(d.querySelector('.cliente-cabecera script'), null);
    for (const r of registros) {
      const fila = d.querySelector('[data-ref="' + r.ref + '"]');
      assert.equal(fila.children.length, 10);
      assert.ok(fila.querySelector('form[action="/admin/trabajo/' + r.ref + '"]'));
      assert.ok(fila.querySelector('form[action="/admin/evidencia/' + r.ref + '"]'));
      assert.equal(!!d.querySelector('#edit-' + r.ref), rol === 'admin');
    }
  }
});

test('Búsqueda y filtros se resuelven en servidor y devuelven el comprador completo', async () => {
  fixture.sembrarAgendaAgrupada();
  for (const [query, refs] of [
    ['buscar=3000000002', ['INVITADO-1', 'INVITADO-2']],
    ['buscar=servicio+segundo', ['CLIENTE-A-1', 'CLIENTE-A-2', 'CLIENTE-A-3']],
    ['estado=pendiente_verificacion', ['CLIENTE-A-1', 'CLIENTE-A-2', 'CLIENTE-A-3']],
    ['buscar=no+existe', []],
  ]) {
    const d = parseHTML(await (await fetch(url + '/admin?' + query, { headers: { cookie } })).text()).document;
    assert.deepEqual([...d.querySelectorAll('#cuerpo-tabla tr[data-ref]')].map(r => r.dataset.ref), refs);
    assert.equal(d.querySelector('#stat-personas').textContent, '2', 'Los filtros no cambian los totales globales');
    assert.equal(d.querySelector('#stat-agendados').textContent, '4');
    assert.ok(d.querySelector('#agenda-busqueda'));
  }
});

test('Entregar servicios reduce trabajos, y solo el último confirmado reduce personas; persiste tras recargar', async () => {
  fixture.sembrarAgendaAgrupada();
  for (const [ref, personas, trabajos] of [
    ['CLIENTE-A-1', 2, 3], ['CLIENTE-A-2', 1, 2], ['INVITADO-1', 1, 1], ['INVITADO-2', 0, 0],
  ]) {
    const respuesta = await fetch(url + '/admin/trabajo/' + ref, {
      method: 'POST', headers: { cookie, origin: url }, body: new URLSearchParams({ accion: 'marcar' }), redirect: 'manual',
    });
    assert.equal(respuesta.status, 302);
    const dom = await pagina(), d = dom.window.document;
    assert.equal(d.querySelector('#stat-personas').textContent, String(personas));
    assert.equal(d.querySelector('#stat-agendados').textContent, String(trabajos));
    assert.equal(d.querySelector('[data-tab=agenda] .tab-count').textContent, String(personas));
    assert.equal(d.querySelector('[data-ref="' + ref + '"]'), null);
  }
});
