'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
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
  process.env.WOMPI_INTEGRITY_SECRET = 'integridad-prueba';
  process.env.WOMPI_PUBLIC_KEY = 'pub_test_sintetica';
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

test('Lecturas y trabajos se separan sin dividir compradores; sus métricas no se mezclan', async () => {
  fixture.sembrarAgendaAgrupada();
  fixture.trabajos.set('LECTURA-HISTORICA', {
    ref: 'LECTURA-HISTORICA', cliente_id: 'CLIENTE-A', estado: 'agendado',
    producto: require('../lib/tipo-servicio').lecturas[0], precio_cop: 10000,
  });
  for (const [tipo, personas, trabajos, filas] of [['trabajo', 2, 4, 6], ['lectura', 1, 1, 1], ['todos', 2, 5, 7]]) {
    const html = await (await fetch(url + '/admin?tipo=' + tipo, { headers: { cookie } })).text();
    const d = parseHTML(html).document;
    assert.equal(d.querySelector('#stat-personas').textContent, String(personas));
    assert.equal(d.querySelector('#stat-agendados').textContent, String(trabajos));
    assert.equal(d.querySelectorAll('#cuerpo-tabla tr[data-ref]').length, filas);
    assert.equal(d.querySelector('input[name=tipo]').value, tipo);
    assert.ok(d.querySelector('[data-filtro=agendado]').href.includes('tipo=' + tipo));
    assert.equal(d.querySelector('[data-filtro=pendiente_pago]'), null);
    assert.deepEqual([...d.querySelectorAll('[data-filtro]')].map(el => el.dataset.filtro),
      ['todos', 'pendiente_verificacion', 'agendado', 'rechazado']);
    if (tipo === 'lectura') {
      assert.match(d.querySelector('#cuerpo-tabla').textContent, /1 lectura/);
      assert.doesNotMatch(d.querySelector('#cuerpo-tabla').textContent, /1 trabajo/);
    }
  }
});

test('Cotización HTTP y pagos usan USD convertido a COP, con firma, tipos y tasa congelada', async () => {
  const catalogo = [...require('../lib/catalogo-compra').cargarEstaticos(fs.readFileSync(require.resolve('../index.html'), 'utf8')).values()];
  const lectura = catalogo.find(i => i.tipo === 'lectura');
  const hechizo = catalogo.find(i => i.tipo === 'hechizo');
  const postJson = async (ruta, datos) => {
    const r = await fetch(url + ruta, { method: 'POST', headers: { Origin: url, 'Content-Type': 'application/json' }, body: JSON.stringify(datos) });
    return { status: r.status, data: await r.json() };
  };
  const input = item => ({ nombre: item.nombre, precio_cop: item.precio_cop, precio_usd: item.precio_usd, es_adelanto: false });
  const q = await postJson('/api/cotizacion', { items: [input(lectura)], metodo: 'wompi', divisa: 'PEN' });
  assert.equal(q.status, 200);
  assert.equal(q.data.items[0].cop, Math.round(lectura.precio_usd * 4000));
  const body = new URLSearchParams({ producto: lectura.nombre, precio_cop: lectura.precio_cop, precio_usd: lectura.precio_usd,
    cliente_nombre: 'Comprador sintético', contacto: 'Contacto sintético', objetivo_nombre: 'Objetivo sintético', metodo: 'wompi' });
  const antes = fixture.trabajos.size;
  const rechaza = await fetch(url + '/api/booking', { method: 'POST', headers: { Origin: url }, body });
  assert.equal(rechaza.status, 409);
  assert.equal(fixture.trabajos.size, antes);
  body.set('cotizacion', q.data.token);
  const booking = await (await fetch(url + '/api/booking', { method: 'POST', headers: { Origin: url }, body })).json();
  assert.equal(booking.precio_cop, q.data.total_cop);
  assert.ok(booking.ref);
  const reg = fixture.trabajos.get(booking.ref);
  assert.equal(reg.tipo_servicio, 'lectura');
  assert.equal(reg.tasa_usd_cop, 4000);
  assert.equal(reg.divisa_vista, 'PEN');
  const crypto = require('node:crypto');
  assert.equal(booking.signature, crypto.createHash('sha256').update(booking.ref + (booking.precio_cop * 100) + 'COPintegridad-prueba').digest('hex'));
  const items = [input(lectura), input(hechizo)].map(i => ({ ...i, objetivo_nombre: 'Objetivo sintético' }));
  const quote = await postJson('/api/cotizacion', { items, metodo: 'wompi', divisa: 'EUR' });
  const pedido = await postJson('/api/checkout', {
    cliente_nombre: 'Comprador sintético', contacto: 'Contacto sintético', metodo: 'wompi',
    items: JSON.stringify(items), cotizacion: quote.data.token,
  });
  assert.equal(pedido.status, 200);
  assert.equal(pedido.data.total_cop, quote.data.total_cop);
  const registros = [...fixture.trabajos.values()].filter(r => r.pedido_ref === pedido.data.pedido_ref);
  assert.deepEqual(registros.map(r => r.tipo_servicio), ['lectura', 'trabajo']);
  assert.ok(registros.every(r => r.pedido_total_cop === quote.data.total_cop && r.tasa_usd_cop === 4000));
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

test('Buscar recupera al comprador completo; un filtro de estado solo muestra sus coincidencias', async () => {
  fixture.sembrarAgendaAgrupada();
  for (const [query, refs] of [
    ['buscar=3000000002', ['INVITADO-1', 'INVITADO-2']],
    ['buscar=servicio+segundo', ['CLIENTE-A-1', 'CLIENTE-A-2', 'CLIENTE-A-3']],
    ['estado=pendiente_verificacion', ['CLIENTE-A-3']],
    ['estado=agendado', ['CLIENTE-A-1', 'CLIENTE-A-2', 'INVITADO-1', 'INVITADO-2']],
    ['buscar=no+existe', []],
  ]) {
    const d = parseHTML(await (await fetch(url + '/admin?' + query, { headers: { cookie } })).text()).document;
    assert.deepEqual([...d.querySelectorAll('#cuerpo-tabla tr[data-ref]')].map(r => r.dataset.ref), refs);
    assert.equal(d.querySelector('#stat-personas').textContent, '2', 'Los filtros no cambian los totales globales');
    assert.equal(d.querySelector('#stat-agendados').textContent, '4');
    assert.ok(d.querySelector('#agenda-busqueda'));
  }
});

test('Los filtros no mezclan estados ni tipos de servicios de un comprador', async () => {
  fixture.sembrarAgendaAgrupada();
  for (const [ref, estado, tipo_servicio] of [
    ['MIX-PEND', 'pendiente_pago', 'trabajo'], ['MIX-RECH', 'rechazado', 'trabajo'],
    ['MIX-LECTURA', 'agendado', 'lectura'], ['MIX-LECTURA-PEND', 'pendiente_pago', 'lectura'],
  ]) fixture.trabajos.set(ref, { ref, estado, tipo_servicio, cliente_id: 'CLIENTE-A', cliente_nombre: 'Cliente de prueba' });
  for (const tipo of ['trabajo', 'lectura', 'todos']) {
    for (const estado of ['agendado', 'pendiente_pago', 'pendiente_verificacion', 'rechazado']) {
      const params = new URLSearchParams({ tipo, estado, buscar: 'Cliente de prueba' });
      const d = parseHTML(await (await fetch(url + '/admin?' + params, { headers: { cookie } })).text()).document;
      for (const fila of d.querySelectorAll('#cuerpo-tabla tr[data-ref]')) {
        const registro = fixture.trabajos.get(fila.dataset.ref);
        assert.equal(registro.estado, estado);
        if (tipo !== 'todos') assert.equal(require('../lib/tipo-servicio').tipoServicio(registro), tipo);
      }
      assert.equal(d.querySelector('[data-filtro=pendiente_pago]'), null);
    }
  }
});

test('Adelantos independientes conservan registro y valor sin inflar personas ni trabajos entregables', async () => {
  fixture.trabajos.clear();
  for (const r of [
    { ref: 'CONT-S', cliente_id: 'CONT-C', producto: 'Servicio' },
    { ref: 'CONT-A', cliente_id: 'CONT-C', producto: 'Adelanto', adelanto: 'solo' },
    { ref: 'CONT-O', cliente_id: 'CONT-OTRO', producto: 'Solo recargo', adelanto: 'solo' },
    { ref: 'CONT-H', cliente_id: 'CONT-HIST', producto: 'Recargo histórico', adelanto: 'solo', trabajo_hecho: true },
  ]) fixture.trabajos.set(r.ref, { estado: 'agendado', precio_cop: 10000,
    finanzas_compra: { version: 1, servicios_cop: 10000, comision_cop: 0, cobrado_cop: 10000 }, ...r });
  const leer = async () => (await pagina()).window.document;
  const numeros = async (personas, trabajos, total, entregados) => {
    const d = await leer();
    for (const [id, valor] of [['stat-personas', personas], ['stat-agendados', trabajos], ['stat-total', total]]) {
      assert.equal(d.getElementById(id).textContent, String(valor));
    }
    assert.equal(d.querySelector('[data-tab=agenda] .tab-count').textContent, String(personas));
    assert.equal(d.querySelector('[data-tab=realizados] .tab-count').textContent, String(entregados));
    assert.equal(d.querySelector('#stat-ingresos').textContent, '$40.000');
    for (const ref of ['CONT-A', 'CONT-O', 'CONT-H']) {
      const fila = d.querySelector('[data-ref="' + ref + '"]');
      assert.ok(fila, 'El recargo sigue visible, incluso si antes fue marcado realizado');
      assert.equal(fila.querySelector('.trabajo-form'), null);
      assert.ok(fila.querySelector('a[href="/admin/adelanto/' + ref + '"]'));
    }
    return d;
  };
  await numeros(1, 1, 4, 0);
  const mutar = async (ruta, datos = {}) => fetch(url + ruta, {
    method: 'POST', redirect: 'manual', headers: { cookie, origin: url, accept: 'application/json' },
    body: new URLSearchParams(datos),
  });
  const imposible = await mutar('/admin/trabajo/CONT-A', { accion: 'marcar' });
  assert.equal(imposible.status, 400);
  assert.equal(fixture.trabajos.get('CONT-A').trabajo_hecho, undefined);
  assert.equal((await mutar('/admin/trabajo/CONT-S', { accion: 'marcar' })).status, 200);
  await numeros(0, 0, 3, 1);
  assert.equal((await mutar('/admin/trabajo/CONT-S', { accion: 'desmarcar' })).status, 200);
  await numeros(1, 1, 4, 0);
  await mutar('/admin/eliminar/CONT-S');
  await numeros(0, 0, 3, 0);
  await mutar('/admin/restaurar/CONT-S');
  await numeros(1, 1, 4, 0);
  const historico = (await leer()).querySelector('[data-ref=CONT-H]');
  assert.ok(historico.querySelector('input[name=accion][value=desmarcar]'));
  assert.equal(!!historico.querySelector('.badge.trab'), false);
  assert.equal((await mutar('/admin/trabajo/CONT-H', { accion: 'desmarcar' })).status, 200);
  await numeros(1, 1, 4, 0);
  const html = templates.adminDashboard({ registros: [...fixture.trabajos.values()], tipoPanel: 'trabajo' });
  const respaldo = parseHTML(html).document;
  assert.equal(respaldo.querySelector('#stat-personas').textContent, '1');
  assert.equal(respaldo.querySelector('#stat-agendados').textContent, '1');
  assert.match(respaldo.querySelector('[data-trabajos-grupo="0"]').textContent, /adelanto independiente/);
});

test('Buscar adelanto incluido encuentra el pedido y separa esos trabajos en la agenda', async () => {
  fixture.sembrarAgendaAgrupada();
  fixture.trabajos.get('CLIENTE-A-1').adelanto = 'incluido';
  const html = await (await fetch(url + '/admin?buscar=adelanto', { headers: { cookie } })).text();
  const d = parseHTML(html).document;
  const filas = [...d.querySelectorAll('#cuerpo-tabla tr[data-ref]')];
  assert.deepEqual(filas.map(r => r.dataset.ref), ['CLIENTE-A-1', 'CLIENTE-A-2', 'CLIENTE-A-3'],
    'El filtro conserva los otros servicios del mismo comprador');
  assert.match(d.querySelector('.agenda-zone-adelanto').textContent, /Trabajos con adelanto incluido/);
  assert.equal(d.querySelector('.agenda-zone-adelanto').nextElementSibling.nextElementSibling.dataset.ref, 'CLIENTE-A-1');
  assert.match(d.querySelector('#cuerpo-tabla').textContent, /Otros servicios · revisar estado de pago/);
  assert.match(d.querySelector('[data-ref="CLIENTE-A-1"]').textContent, /Incluye adelanto/);
});

test('Con adelanto es un filtro visible que excluye servicios normales, recargos y pagos sin confirmar', async () => {
  fixture.sembrarAgendaAgrupada();
  fixture.trabajos.get('CLIENTE-A-1').adelanto = 'incluido';
  fixture.trabajos.get('CLIENTE-A-3').adelanto = 'incluido';
  fixture.trabajos.set('RECARGO-FILTRO', {
    ref: 'RECARGO-FILTRO', cliente_id: 'CLIENTE-A', estado: 'agendado', adelanto: 'solo',
  });
  fixture.trabajos.set('LECTURA-URGENTE', {
    ref: 'LECTURA-URGENTE', cliente_id: 'CLIENTE-A', estado: 'agendado', tipo_servicio: 'lectura',
    adelanto_origen_ref: 'ORIGEN', adelanto_vinculado_activo: true,
  });
  const consultar = async params => parseHTML(await (await fetch(url + '/admin?' + params, { headers: { cookie } })).text()).document;
  const inicial = await consultar('tipo=todos');
  assert.equal(inicial.querySelector('[data-adelanto]').textContent, 'Con adelanto');
  for (const [tipo, refs] of [
    ['trabajo', ['CLIENTE-A-1']], ['lectura', ['LECTURA-URGENTE']], ['todos', ['CLIENTE-A-1', 'LECTURA-URGENTE']],
  ]) {
    const d = await consultar(new URLSearchParams({ tipo, estado: 'agendado', adelanto: 'si' }));
    assert.deepEqual([...d.querySelectorAll('#cuerpo-tabla tr[data-ref]')].map(r => r.dataset.ref).sort(), refs);
    assert.equal(d.querySelector('[data-adelanto]').getAttribute('aria-current'), 'true');
    assert.equal(new URL(d.querySelector('[data-adelanto]').href, url).searchParams.get('adelanto'), 'todos');
    assert.equal(d.querySelector('input[name=adelanto]').value, 'si');
    for (const a of d.querySelectorAll('[data-filtro], [data-agenda-renovar], nav[aria-label="Tipo de servicio"] a')) {
      assert.equal(new URL(a.href, url).searchParams.get('adelanto'), 'si');
    }
  }
  const vacia = await consultar('tipo=todos&adelanto=si&estado=pendiente_verificacion');
  assert.equal(vacia.querySelectorAll('#cuerpo-tabla tr[data-ref]').length, 0);
});

test('Entregar y devolver un adelanto actualiza zonas sin mover otros servicios a urgentes', async () => {
  fixture.sembrarAgendaAgrupada();
  fixture.trabajos.get('CLIENTE-A-1').adelanto = 'incluido';
  fixture.trabajos.get('CLIENTE-A-3').adelanto = 'incluido';
  fixture.trabajos.set('INDEPENDIENTE', {
    ref: 'INDEPENDIENTE', cliente_id: 'CLIENTE-A', adelanto: 'solo', estado: 'agendado',
  });
  const consultar = async () => parseHTML(await (await fetch(url + '/admin?buscar=urgencia', { headers: { cookie } })).text()).document;
  let d = await consultar();
  assert.equal(d.querySelectorAll('#cuerpo-tabla tr[data-ref]').length, 4);
  assert.equal(d.querySelector('#stat-personas').textContent, '2');
  assert.match(d.querySelector('[data-ref=INDEPENDIENTE]').textContent, /sin servicio asociado/);
  assert.match(d.querySelector('[data-ref=CLIENTE-A-3]').textContent, /sin pago confirmado/);
  for (const [accion, urgente] of [['marcar', false], ['desmarcar', true]]) {
    const respuesta = await fetch(url + '/admin/trabajo/CLIENTE-A-1', {
      method: 'POST', headers: { cookie, origin: url, accept: 'application/json' },
      body: new URLSearchParams({ accion }),
    });
    assert.equal(respuesta.status, 200);
    assert.equal((await respuesta.json()).realizado, !urgente);
    d = await consultar();
    assert.equal(!!d.querySelector('.agenda-zone-adelanto'), urgente);
    assert.equal(d.querySelectorAll('#cuerpo-tabla tr[data-ref]').length, urgente ? 4 : 3);
    assert.equal(d.querySelector('#stat-personas').textContent, '2',
      'El comprador conserva otros servicios confirmados');
    if (urgente) {
      assert.equal(d.querySelector('.agenda-zone-adelanto').nextElementSibling.nextElementSibling.dataset.ref, 'CLIENTE-A-1');
    }
  }
  for (const ref of ['CLIENTE-A-3', 'SIN-PAGO']) {
    const respuesta = await fetch(url + '/admin/trabajo/' + ref, {
      method: 'POST', headers: { cookie, origin: url, accept: 'application/json' },
      body: new URLSearchParams({ accion: 'marcar' }),
    });
    assert.equal(respuesta.status, 400, 'Sin pago confirmado no se permite entregar');
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
