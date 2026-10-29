'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { crearClienteWompi } = require('../lib/wompi');
const publica = 'pub_test_sintetica';
const privada = 'prv_test_sintetica';
const tx = { id: 'TX-TEST', reference: 'REF-TEST', status: 'APPROVED', amount_in_cents: 100000, currency: 'COP' };
const response = (data, status = 200) => new Response(JSON.stringify({ data }), { status });

test('Consultas Wompi autenticadas y privadas, ambiente correcto y parámetros escapados', async () => {
  for (const prod of [false, true]) {
    const calls = [], logs = [];
    const key = prod ? 'prv_prod_sintetica' : privada;
    const client = crearClienteWompi({
      publicKey: prod ? 'pub_prod_sintetica' : publica, privateKey: key,
      log: { warn: (...args) => logs.push(args) },
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return response(url.includes('?') ? [{ ...tx, reference: 'R /?&' }] : tx);
      },
    });
    assert.deepEqual(await client.transaccion(tx.id), tx);
    assert.equal((await client.porReferencia('R /?&')).length, 1);
    assert.equal(new URL(calls[0].url).host, (prod ? 'production' : 'sandbox') + '.wompi.co');
    assert.equal(new URL(calls[1].url).searchParams.get('reference'), 'R /?&');
    for (const c of calls) {
      assert.equal(c.options.headers.Authorization, 'Bearer ' + key);
      assert.ok(c.options.signal instanceof AbortSignal);
      assert.ok(!c.url.includes(key));
    }
    assert.ok(!JSON.stringify(logs).includes(key));
  }
});

test('Configuración incompleta o de ambientes distintos no consulta Wompi ni revela llaves', async () => {
  for (const key of ['', 'prv_prod_sintetica']) {
    const logs = [];
    const client = crearClienteWompi({ publicKey: publica, privateKey: key,
      log: { warn: (...args) => logs.push(args) }, fetchImpl: async () => assert.fail('Red prohibida') });
    assert.equal(client.configuracion().configurado, false);
    await assert.rejects(client.transaccion(tx.id), /No se pudo verificar/);
    assert.equal(await client.porReferencia(tx.reference), null);
    assert.ok(!JSON.stringify(logs).includes('prv_'));
  }
});

test('HTTP 401/403/429/500, JSON malformado y errores de red son reintentables, no listas vacías', async () => {
  for (const fetchImpl of [
    ...[401, 403, 429, 500].map(status => async () => new Response('secreto-en-cuerpo', { status })),
    async () => new Response('no es json'),
    async () => { throw new Error('secreto-en-error-de-red'); },
    async () => response({ inesperado: true }),
  ]) {
    const logs = [];
    const client = crearClienteWompi({ publicKey: publica, privateKey: privada, fetchImpl,
      log: { warn: (...args) => logs.push(args) } });
    await assert.rejects(client.transaccion(tx.id));
    assert.equal(await client.porReferencia(tx.reference), null);
    assert.ok(!JSON.stringify(logs).includes('secreto-en'));
    assert.ok(!JSON.stringify(logs).includes(privada));
  }
});

test('Transacción ajena, lista no filtrada y consulta colgada no se aceptan como ausencia de pago', async () => {
  const quiet = { warn() {} };
  const other = crearClienteWompi({ publicKey: publica, privateKey: privada, log: quiet,
    fetchImpl: async url => response(url.includes('?') ? [{ ...tx, reference: 'OTRA' }] : { ...tx, id: 'OTRA' }) });
  await assert.rejects(other.transaccion(tx.id), /respuesta_transaccion_invalida/);
  assert.equal(await other.porReferencia(tx.reference), null);
  const slow = crearClienteWompi({ publicKey: publica, privateKey: privada, log: quiet, timeoutMs: 10,
    fetchImpl: async (_, { signal }) => new Promise((resolve, reject) =>
      signal.addEventListener('abort', () => reject(new Error('abortado')), { once: true })) });
  await assert.rejects(slow.transaccion(tx.id), /consulta_timeout/);
  assert.equal(await slow.porReferencia(tx.reference), null);
});
