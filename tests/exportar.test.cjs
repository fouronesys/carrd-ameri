'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { inflateSync } = require('node:zlib');
const XLSX = require('xlsx');
const { parseHTML } = require('linkedom');
const { generarExcel, generarPDF } = require('../lib/exportar');
const { describirTarifa } = require('../lib/reporte-tarifas');

function tarifasSinteticas() {
  return [
    { ref: 'LOCAL', base_divisa: 'COP', divisa_vista: 'COP', tasa_usd_cop: 4000, precio_cop: 23000 },
    { ref: 'DOLAR', base_divisa: 'USD', divisa_vista: 'USD', tasa_usd_cop: 4000, precio_cop: 40000 },
    { ref: 'EURO', base_divisa: 'USD', divisa_vista: 'EUR', tasa_usd_cop: 4100, precio_cop: 41000 },
    { ref: 'SIN-TASA', base_divisa: 'USD', divisa_vista: 'MXN', precio_cop: 40500 },
    { ref: 'ANTIGUO', precio_cop: 17000 },
    { ref: 'PARCIAL', divisa_vista: 'EUR', precio_cop: 25000 },
    { ref: 'SIN-PAGO', base_divisa: 'USD', divisa_vista: 'USD', tasa_usd_cop: 5000, precio_cop: 50000, estado: 'pendiente_pago' },
  ].map(r => ({ producto: 'Mismo servicio', metodo: 'transferencia', estado: 'agendado', ...r }));
}

test('Tarifas independientes en Excel y PDF: preserva COP, distingue divisa vista y no inventa tasas ni tarifas', async () => {
  const registros = tarifasSinteticas(), original = structuredClone(registros);
  const { filas, resumen } = excel(generarExcel(registros));
  assert.deepEqual(filas.map(r => r['Importe registrado (COP)']), registros.map(r => r.precio_cop));
  assert.deepEqual(filas.map(r => r['Tarifa aplicada']), ['COP', 'USD', 'USD', 'USD', 'No registrada', 'No registrada', 'USD']);
  assert.deepEqual(filas.map(r => r['Divisa vista']), ['COP', 'USD', 'EUR', 'MXN', 'No registrada', 'EUR', 'USD']);
  assert.deepEqual(filas.map(r => r['Tasa USD/COP registrada']), [4000, 4000, 4100, 'No registrada', 'No registrada', 'No registrada', 5000]);
  assert.match(filas[4]['Metadatos de tarifa'], /Sin metadatos/);
  assert.equal(filas[5]['Metadatos de tarifa'], 'Metadatos incompletos');
  assert.ok(Object.keys(resumen).some(k => k.includes('Tarifas COP y USD independientes')));
  const text = textoPDF(await pdf(registros));
  for (const r of registros) {
    assert.ok(text.includes('Importe registrado: ' + r.precio_cop + ' COP'), r.ref);
    assert.ok(text.includes(describirTarifa(r).detalle), r.ref);
  }
  assert.ok(text.includes('Tarifas COP y USD independientes'));
  assert.deepEqual(registros, original);
});

test('Metadatos inválidos, vacíos y parciales no permiten inferir datos históricos', () => {
  for (const tasa of [null, '', 0, -1, 'NaN', Infinity]) {
    assert.equal(describirTarifa({ base_divisa: 'USD', divisa_vista: 'EUR', tasa_usd_cop: tasa }).tasa, null);
  }
  assert.equal(describirTarifa({ tasa_usd_cop: 4000 }).tarifa, 'No registrada');
  assert.equal(describirTarifa({ base_divisa: 'COP' }).vista, 'No registrada');
  assert.equal(describirTarifa({ base_divisa: 'EUR' }).tarifa, 'No reconocida');
});

// Inspect PDFKit's actual compressed text operators, without requiring a PDF
// reader dependency or replacing the renderer with a mock.
function textoPDF(buffer) {
  const source = buffer.toString('latin1');
  return [...source.matchAll(/\/Length (\d+)[\s\S]*?stream\r?\n/g)].map(m => {
    const inicio = m.index + m[0].length;
    const content = inflateSync(buffer.subarray(inicio, inicio + Number(m[1]))).toString('latin1');
    return [...content.matchAll(/<([0-9a-f]+)>/gi)]
      .map(hex => Buffer.from(hex[1], 'hex').toString('latin1')).join('');
  }).join('\n');
}

function pdf(registros) {
  return new Promise((resolve, reject) => {
    const stream = new PassThrough(), chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    generarPDF(registros, stream);
  });
}

function excel(buffer) {
  const book = XLSX.read(buffer, { type: 'buffer' });
  return {
    resumen: Object.fromEntries(XLSX.utils.sheet_to_json(book.Sheets.Resumen, { header: 1 }).slice(1)),
    filas: XLSX.utils.sheet_to_json(book.Sheets.Agendamientos),
  };
}

function datos() {
  return [
    { ref: 'A1', cliente_id: ' C1 ', pedido_ref: 'P1' },
    { ref: 'A2', cliente_id: 'C1', pedido_ref: 'P2' },
    { ref: 'B1', cliente_id: 'C2', pedido_ref: 'P3' },
    { ref: 'G1', pedido_ref: 'GUEST1' }, { ref: 'G2', pedido_ref: 'GUEST1' },
    { ref: 'G3', pedido_ref: 'GUEST2' },
    { ref: 'LEGACY1' }, { ref: 'LEGACY2' },
    { ref: 'VERIFY', estado: 'pendiente_verificacion' },
    { ref: 'UNPAID', estado: 'pendiente_pago' },
    { ref: 'REJECTED', estado: 'rechazado' },
    { ref: 'DONE', trabajo_hecho: true, cliente_id: 'DONE' },
    { ref: 'DELETED', eliminado_en: '2026-01-01', cliente_id: 'DELETED' },
  ].map(r => ({
    estado: 'agendado', cliente_nombre: 'Mismo nombre', contacto: 'Compartido',
    objetivo_nombre: 'Misma persona objetivo', producto: 'Lectura', precio_cop: 23000,
    precio_texto: '$23.000 COP', metodo: 'transferencia', ...r,
  }));
}

const PERSONAS = 'Personas agendadas (clientes compradores únicos)';
const TRABAJOS = 'Trabajos agendados (confirmados por entregar)';

test('PDF y Excel cuentan compradores por cuenta/pedido, no nombres, sin perder detalle ni valores', async () => {
  const registros = datos(), original = structuredClone(registros);
  const { resumen, filas } = excel(generarExcel(registros));
  assert.equal(resumen['Clientes compradores únicos (total)'], 9);
  assert.equal(resumen[PERSONAS], 6);
  assert.equal(resumen['Trabajos (total)'], 11);
  assert.equal(resumen[TRABAJOS], 8);
  assert.equal(resumen['Trabajos por verificar'], 1);
  assert.equal(resumen['Trabajos pendientes de pago'], 1);
  assert.equal(resumen['Trabajos rechazados'], 1);
  assert.deepEqual(filas.map(r => r.Referencia), registros.slice(0, 11).map(r => r.ref));
  assert.ok(filas.every(r => r.Servicio === 'Lectura' && r.Valor === '$23.000 COP'));
  assert.equal(filas[0].Pedido, 'P1');
  const text = textoPDF(await pdf(registros));
  for (const [label, value] of Object.entries(resumen).filter(([, v]) => typeof v === 'number')) {
    assert.ok(text.includes(label + ': ' + value), label);
  }
  assert.ok(text.includes('$23.000 COP'));
  assert.ok(text.includes('Lectura'));
  assert.ok(text.includes('invitados por pedido'));
  assert.deepEqual(registros, original, 'Exportar no cambia datos ni estados de pago');
});

test('Agenda vacía y reporte multipágina conservan métricas y encabezados', async () => {
  const vacio = excel(generarExcel([]));
  assert.equal(vacio.filas.length, 0);
  assert.equal(vacio.resumen[PERSONAS], 0);
  assert.equal(vacio.resumen[TRABAJOS], 0);
  assert.ok(textoPDF(await pdf([])).includes(PERSONAS + ': 0'));
  const muchos = Array.from({ length: 90 }, (_, i) => ({
    ref: 'REF-' + i, pedido_ref: 'PED-' + i, estado: 'agendado',
    producto: 'Servicio ' + i, precio_cop: 10000,
  }));
  const buffer = await pdf(muchos), text = textoPDF(buffer);
  assert.ok((buffer.toString('latin1').match(/\/Type \/Page\b/g) || []).length >= 3);
  assert.ok(text.includes(PERSONAS + ': 90'));
  assert.ok(text.includes('Servicio 89'));
  assert.ok(text.split('Comprob.').length >= 4, 'Repite el encabezado de detalle por página');
});

let fixture, server, url, cookie;
before(async () => {
  Object.assign(process.env, {
    ADMIN_PASSWORD: 'isolated-admin-test', ASSISTANT_PASSWORD: 'isolated-assistant-test',
    SESSION_SECRET: 'isolated-session-test-not-a-live-secret', NODE_ENV: 'test',
  });
  fixture = require('./helpers/admin-fixture.cjs');
  server = fixture.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  url = 'http://127.0.0.1:' + server.address().port;
  const login = await fetch(url + '/admin/login', {
    method: 'POST', redirect: 'manual', headers: { Origin: url },
    body: new URLSearchParams({ password: 'isolated-admin-test' }),
  });
  assert.equal(login.status, 302);
  cookie = login.headers.get('set-cookie').split(';')[0];
});
after(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});

test('Panel conserva ingresos históricos COP, explica tarifas en agenda, realizados y papelera y escapa metadatos', async () => {
  fixture.trabajos.clear();
  const registros = tarifasSinteticas().concat([
    { ref: 'ENTREGADO', producto: 'Entregado', estado: 'agendado', precio_cop: 12000, trabajo_hecho: true, base_divisa: 'USD', divisa_vista: 'EUR', tasa_usd_cop: 3900 },
    { ref: 'BORRADO', producto: 'Borrado', estado: 'agendado', precio_cop: 13000, eliminado_en: '2026-01-01' },
    { ref: 'MALICIOSO', estado: 'rechazado', base_divisa: '<script>mal()</script>', divisa_vista: '<img src=x>' },
  ]);
  registros.forEach(r => fixture.trabajos.set(r.ref, structuredClone(r)));
  const antes = structuredClone([...fixture.trabajos.values()]);
  const panel = await (await fetch(url + '/admin?tipo=todos', { headers: { Cookie: cookie } })).text();
  const d = parseHTML(panel).document;
  const ingresos = registros.filter(r => r.estado === 'agendado').reduce((s, r) => s + r.precio_cop, 0);
  assert.ok(d.querySelector('.stats').textContent.includes('$' + ingresos.toLocaleString('es-CO')));
  assert.ok(d.body.textContent.includes('Tarifas COP y USD independientes'));
  for (const r of registros.filter(r => !r.trabajo_hecho && !r.eliminado_en)) {
    assert.ok(d.body.textContent.includes(describirTarifa(r).detalle), r.ref);
  }
  for (const [tab, ref] of [['realizados', 'ENTREGADO'], ['eliminados', 'BORRADO']]) {
    const html = await (await fetch(url + '/admin?tipo=todos&tab=' + tab, { headers: { Cookie: cookie } })).text();
    const documento = parseHTML(html).document;
    const seccion = documento.querySelector('.admin-sec.activo[data-sec="' + tab + '"]');
    assert.ok(seccion, 'La pestaña solicitada está activa: ' + tab);
    const fila = [...seccion.querySelectorAll('tbody tr')].find(tr => tr.textContent.includes(ref));
    assert.ok(fila, 'El registro correcto aparece en la sección: ' + ref);
    assert.ok(fila.textContent.includes(describirTarifa(registros.find(r => r.ref === ref)).detalle), tab);
  }
  assert.ok(!panel.includes('<script>mal()</script>'));
  const login = await fetch(url + '/admin/login', {
    method: 'POST', redirect: 'manual', headers: { Origin: url },
    body: new URLSearchParams({ password: 'isolated-assistant-test' }),
  });
  const asistente = login.headers.get('set-cookie').split(';')[0];
  for (const formato of ['excel', 'pdf']) {
    const respuesta = await fetch(url + '/admin/exportar/' + formato, { headers: { Cookie: asistente } });
    assert.equal(respuesta.status, 200, 'Conserva el permiso de exportación existente del asistente');
    await respuesta.arrayBuffer();
  }
  const editar = await fetch(url + '/admin/editar/LOCAL', {
    method: 'POST', headers: { Cookie: asistente, Origin: url },
    body: new URLSearchParams({ precio_cop: 1 }),
  });
  assert.equal(editar.status, 403, 'Editar importes sigue siendo exclusivo del administrador');
  assert.deepEqual([...fixture.trabajos.values()], antes);
});

test('Rutas protegidas exportan la agenda completa y coinciden con el panel tras entregas parciales', async () => {
  for (const formato of ['excel', 'pdf']) {
    const r = await fetch(url + '/admin/exportar/' + formato, { redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/admin');
  }
  fixture.sembrarAgendaAgrupada();
  // Incluir todos los estados y comprobar el alcance de la consulta de exportación.
  fixture.trabajos.set('REJECTED', { ref: 'REJECTED', estado: 'rechazado' });
  fixture.trabajos.set('DELETED', { ref: 'DELETED', estado: 'agendado', eliminado_en: '2026-01-01' });
  for (const [ref, personas, trabajos] of [
    [null, 2, 4], ['CLIENTE-A-1', 2, 3], ['CLIENTE-A-2', 1, 2],
    ['INVITADO-1', 1, 1], ['INVITADO-2', 0, 0],
  ]) {
    if (ref) {
      const delivered = await fetch(url + '/admin/trabajo/' + ref, {
        method: 'POST', redirect: 'manual', headers: { Cookie: cookie, Origin: url },
        body: new URLSearchParams({ accion: 'marcar' }),
      });
      assert.equal(delivered.status, 302);
    }
    const panel = await (await fetch(url + '/admin', { headers: { Cookie: cookie } })).text();
    const d = parseHTML(panel).document;
    assert.equal(d.querySelector('#stat-personas').textContent, String(personas));
    assert.equal(d.querySelector('#stat-agendados').textContent, String(trabajos));
    const beforeExport = structuredClone([...fixture.trabajos.values()]);
    for (const formato of ['excel', 'pdf']) {
      const r = await fetch(url + '/admin/exportar/' + formato, { headers: { Cookie: cookie } });
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-disposition'), /^attachment; filename="fresatanika-agendamientos-/);
      const buffer = Buffer.from(await r.arrayBuffer());
      if (formato === 'excel') {
        assert.match(r.headers.get('content-type'), /spreadsheetml/);
        const { resumen, filas } = excel(buffer);
        assert.equal(resumen[PERSONAS], personas);
        assert.equal(resumen[TRABAJOS], trabajos);
        assert.equal(resumen['Trabajos (total)'], trabajos + 3);
        assert.equal(filas.length, trabajos + 3);
        assert.ok(!filas.some(r => r.Referencia === 'DELETED'));
      } else {
        assert.match(r.headers.get('content-type'), /application\/pdf/);
        const text = textoPDF(buffer);
        assert.ok(text.includes(PERSONAS + ': ' + personas));
        assert.ok(text.includes(TRABAJOS + ': ' + trabajos));
        assert.ok(text.includes('Trabajos (total): ' + (trabajos + 3)));
      }
    }
    assert.deepEqual([...fixture.trabajos.values()], beforeExport);
  }
});
