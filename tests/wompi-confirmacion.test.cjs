'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { once } = require('node:events');
const session = require('express-session');

// Todo se sustituye ANTES de cargar la aplicación: ninguna conexión a PG,
// SMTP o Wompi real y ninguna lectura de credenciales del entorno.
Object.assign(process.env, {
  NODE_ENV: 'test', SESSION_SECRET: 'sesion-wompi-aislada',
  WOMPI_PUBLIC_KEY: 'pub_test_sintetica', WOMPI_PRIVATE_KEY: 'prv_test_sintetica',
  WOMPI_EVENTS_SECRET: 'eventos-sinteticos',
});
function sustituir(nombre, exports) {
  const id = require.resolve(nombre);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
const rows = new Map(), enviados = [], carritos = [], txs = new Map();
const copia = x => x == null ? x : JSON.parse(JSON.stringify(x));
const pedido = ref => [...rows.values()].filter(r => r.pedido_ref === ref);
let borrados = 0, apiError = 0, lookups = 0, shapeError = false;
const db = {
  DATA_DIR: '/tmp', UPLOADS_DIR: '/tmp', pool: {},
  obtenerPorRef: async ref => copia(rows.get(ref)),
  obtenerPorPedido: async ref => copia(pedido(ref)),
  actualizarPorRef: async (ref, cambios) => { Object.assign(rows.get(ref), cambios); return copia(rows.get(ref)); },
  actualizarPorPedido: async (ref, cambios) => { pedido(ref).forEach(r => Object.assign(r, cambios)); },
  actualizarEstadoWompi: async (ref, cambios, esPedido) => {
    const candidatas = esPedido ? pedido(ref) : [rows.get(ref)].filter(Boolean);
    const cambiadas = candidatas.filter(r => r.metodo === 'wompi' &&
      ['pendiente_pago', 'rechazado'].includes(r.estado) && r.estado !== cambios.estado);
    cambiadas.forEach(r => Object.assign(r, cambios));
    return copia(cambiadas);
  },
  listarPendientesPagoWompi: async () => copia([...rows.values()].filter(r => r.estado === 'pendiente_pago' && r.metodo === 'wompi')),
  eliminarPendientesAntiguos: async () => { borrados++; return 0; },
  guardarCarritoCliente: async (id, items) => carritos.push({ id, items }),
  obtenerClientePorId: async () => ({ email: 'cliente@example.invalid' }),
};
sustituir('../lib/db', db);
sustituir('connect-pg-simple', () => session.MemoryStore);
sustituir('../lib/mailer', Object.fromEntries(['enviarNotificacion', 'enviarNotificacionPedido', 'enviarEstadoCliente']
  .map(nombre => [nombre, async () => { enviados.push(nombre); return { enviado: true }; }])));
const { app, confirmarPagoRef, confirmarPagoPedido, reconciliarPagosPendientes, limpiarPendientes } = require('../server');

function preparar(esPedido = false, estado = 'pendiente_pago') {
  rows.clear(); enviados.length = 0; carritos.length = 0; txs.clear();
  borrados = 0; lookups = 0; apiError = 0; shapeError = false;
  const referencia = esPedido ? 'FRESA-PED-AISLADO' : 'FRESA-AISLADO';
  for (let i = 0; i < (esPedido ? 2 : 1); i++) {
    const ref = esPedido ? referencia + '-' + i : referencia;
    rows.set(ref, { ref, pedido_ref: esPedido ? referencia : '', pedido_total_cop: 20000,
      precio_cop: esPedido ? 10000 : 20000, metodo: 'wompi', estado,
      cliente_id: 'CLIENTE-AISLADO', creado_en: '2020-01-01T00:00:00Z' });
  }
  txs.set('TX-AISLADA', { id: 'TX-AISLADA', reference: referencia, amount_in_cents: 2000000, currency: 'COP', status: 'APPROVED' });
  return { referencia, confirmar: id => esPedido ? confirmarPagoPedido(referencia, id) : confirmarPagoRef(referencia, id) };
}
function evento(tx, firmaCorrecta = true) {
  const properties = ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'];
  const timestamp = 1700000000;
  const checksum = crypto.createHash('sha256')
    .update(tx.id + tx.status + tx.amount_in_cents + timestamp + 'eventos-sinteticos').digest('hex').toUpperCase();
  return { event: 'transaction.updated', data: { transaction: tx }, timestamp,
    signature: { properties, checksum: firmaCorrecta ? checksum : 'incorrecto' } };
}

test('Confirmación Wompi por HTTP, retorno y reconciliación sin servicios reales', async t => {
  const realFetch = global.fetch, logs = [], originalWarn = console.warn;
  console.warn = (...args) => logs.push(args.join(' '));
  const http = app.listen(0, '127.0.0.1');
  await once(http, 'listening');
  const base = 'http://127.0.0.1:' + http.address().port;
  global.fetch = async (destino, options) => {
    const url = new URL(destino);
    if (url.origin === base) return realFetch(destino, options);
    assert.equal(url.origin, 'https://sandbox.wompi.co', 'Red externa prohibida');
    assert.equal(options.headers.Authorization, 'Bearer prv_test_sintetica');
    lookups++;
    if (apiError) return new Response('dato-privado-que-no-debe-loguearse', { status: apiError });
    const data = shapeError ? {} : url.searchParams.has('reference')
      ? [...txs.values()].filter(tx => tx.reference === url.searchParams.get('reference'))
      : txs.get(decodeURIComponent(url.pathname.split('/').pop()));
    return new Response(JSON.stringify({ data }), { status: data ? 200 : 404 });
  };
  const webhook = (tx, valido = true) => global.fetch(base + '/wompi/webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(evento(tx, valido)),
  });
  try {
    const config = await (await global.fetch(base + '/api/config')).json();
    assert.equal(config.wompiPublicKey, 'pub_test_sintetica');
    assert.ok(!JSON.stringify(config).includes('prv_test_sintetica'), 'La llave privada nunca llega al navegador');
    for (const esPedido of [false, true]) {
      const tipo = esPedido ? 'pedido' : 'individual';
      await t.test(tipo + ': confirmaciones concurrentes y eventos repetidos no duplican correo ni vaciado', async () => {
        const { confirmar } = preparar(esPedido);
        const resultados = await Promise.all([confirmar('TX-AISLADA'), confirmar('TX-AISLADA'), confirmar('TX-AISLADA')]);
        assert.equal(resultados.filter(r => r.agendado).length, 1);
        assert.ok([...rows.values()].every(r => r.estado === 'agendado'));
        assert.equal(enviados.filter(n => n === (esPedido ? 'enviarNotificacionPedido' : 'enviarNotificacion')).length, 1);
        assert.equal(enviados.filter(n => n === 'enviarEstadoCliente').length, 1);
        assert.equal(carritos.length, esPedido ? 1 : 0);
        assert.equal((await webhook(txs.get('TX-AISLADA'))).status, 200);
        assert.equal(enviados.length, 2);
      });
      await t.test(tipo + ': webhook confirmado, firma inválida y evento sin transacción', async () => {
        preparar(esPedido);
        const tx = txs.get('TX-AISLADA');
        assert.equal((await webhook(tx, false)).status, 401);
        assert.equal(lookups, 0);
        assert.equal((await webhook(tx)).status, 200);
        assert.ok([...rows.values()].every(r => r.estado === 'agendado'));
        const timestamp = 1700000000;
        const checksum = crypto.createHash('sha256').update(timestamp + 'eventos-sinteticos').digest('hex');
        const r = await global.fetch(base + '/wompi/webhook', { method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: {}, timestamp, signature: { properties: [], checksum } }) });
        assert.equal(r.status, 200);
      });
      await t.test(tipo + ': retorno comprueba el estado real, no confía en parámetros del navegador', async () => {
        const { referencia } = preparar(esPedido);
        const ruta = esPedido ? '/pedido/' : '/gracias/';
        let r = await global.fetch(base + ruta + referencia + '?status=APPROVED');
        assert.equal(r.status, 200);
        assert.ok([...rows.values()].every(x => x.estado === 'pendiente_pago'));
        r = await global.fetch(base + ruta + referencia + '?id=TX-AISLADA');
        assert.equal(r.status, 200);
        assert.ok([...rows.values()].every(x => x.estado === 'agendado'));
      });
      await t.test(tipo + ': recuperación sin retorno ni webhook, y aprobación posterior a PENDING', async () => {
        preparar(esPedido);
        txs.get('TX-AISLADA').status = 'PENDING';
        assert.equal((await webhook(txs.get('TX-AISLADA'))).status, 200);
        await limpiarPendientes();
        assert.equal(borrados, 0, 'No borrar transacciones aún pendientes en Wompi');
        assert.ok([...rows.values()].every(r => r.estado === 'pendiente_pago'));
        txs.get('TX-AISLADA').status = 'APPROVED';
        const resultado = await reconciliarPagosPendientes();
        assert.equal(resultado.agendados, 1);
        assert.equal(resultado.huboFallos, false);
        assert.ok([...rows.values()].every(r => r.estado === 'agendado'));
      });
      await t.test(tipo + ': referencia, monto y moneda ajenos nunca confirman ni rechazan', async () => {
        for (const cambio of [{ reference: 'OTRA' }, { amount_in_cents: 1 }, { currency: 'USD' }]) {
          const { confirmar } = preparar(esPedido);
          Object.assign(txs.get('TX-AISLADA'), cambio);
          assert.equal((await confirmar('TX-AISLADA')).discrepancia, true);
          txs.get('TX-AISLADA').status = 'DECLINED';
          assert.equal((await confirmar('TX-AISLADA')).discrepancia, true);
          assert.ok([...rows.values()].every(r => r.estado === 'pendiente_pago'));
          assert.equal(enviados.length, 0);
          assert.equal(carritos.length, 0);
        }
        preparar(esPedido);
        txs.get('TX-AISLADA').amount_in_cents = 1;
        await limpiarPendientes();
        assert.equal(borrados, 0, 'No borrar una aprobación con discrepancia');
      });
      await t.test(tipo + ': fallo definitivo, aprobación posterior y pago manual protegido', async () => {
        for (const status of ['DECLINED', 'ERROR', 'VOIDED']) {
          const { confirmar } = preparar(esPedido);
          txs.get('TX-AISLADA').status = status;
          assert.equal((await confirmar('TX-AISLADA')).rechazado, true);
          assert.ok([...rows.values()].every(r => r.estado === 'rechazado'));
          assert.equal(enviados.length, 0);
          txs.get('TX-AISLADA').status = 'APPROVED';
          assert.equal((await confirmar('TX-AISLADA')).agendado, true);
        }
        const { confirmar } = preparar(esPedido, 'pendiente_verificacion');
        rows.forEach(r => { r.metodo = 'transferencia'; });
        assert.equal((await confirmar('TX-AISLADA')).manual, true);
        assert.equal(lookups, 0);
      });
      await t.test(tipo + ': HTTP 401/500 y respuesta incompleta solicitan reintento, conservan registros', async () => {
        for (const status of [401, 500, 0]) {
          preparar(esPedido);
          apiError = status; shapeError = !status;
          assert.equal((await webhook(txs.get('TX-AISLADA'))).status, 500);
          assert.equal((await reconciliarPagosPendientes()).huboFallos, true);
          await limpiarPendientes();
          assert.equal(borrados, 0);
          assert.ok([...rows.values()].every(r => r.estado === 'pendiente_pago'));
          assert.equal(enviados.length, 0);
        }
        shapeError = false;
        const primera = reconciliarPagosPendientes(), segunda = reconciliarPagosPendientes();
        assert.equal(primera, segunda, 'Reutilizar la misma pasada mientras sigue en curso');
        assert.equal((await primera).agendados, 1, 'Recuperar al restablecerse Wompi sin reiniciar el servidor');
      });
    }
    await t.test('La limpieza solo continúa cuando Wompi confirma que no hay intentos', async () => {
      preparar(); txs.clear();
      await limpiarPendientes();
      assert.equal(borrados, 1);
    });
    assert.ok(logs.some(s => s.includes('"http":401')));
    assert.ok(logs.some(s => s.includes('pago_no_coincide')));
    assert.ok(logs.some(s => s.includes('webhook_reintentable')));
    for (const secreto of ['prv_test_sintetica', 'eventos-sinteticos', 'dato-privado', 'cliente@example.invalid']) {
      assert.ok(!logs.join('\n').includes(secreto));
    }
  } finally {
    global.fetch = realFetch; console.warn = originalWarn;
    http.closeAllConnections(); await new Promise(resolve => http.close(resolve));
  }
});
