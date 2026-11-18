'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

test('El resumen ligero exige sesión y solo consulta los totales globales del tipo elegido', async () => {
  process.env.ADMIN_PASSWORD = 'isolated-admin-test';
  process.env.ASSISTANT_PASSWORD = 'isolated-assistant-test';
  process.env.SESSION_SECRET = 'isolated-session-test-not-a-live-secret';
  process.env.NODE_ENV = 'test';
  const { app } = require('./helpers/admin-fixture.cjs');
  const db = require('../lib/db');
  const previas = { resumenPanel: db.resumenPanel, listarAgendaPanel: db.listarAgendaPanel, listarRealizados: db.listarRealizados };
  const consultas = [], resumen = { total: 5, agendados: 3, personas_agendadas: 2, verificar: 1,
    realizados: 4, catalogo: 9, ingresos: 5000, comisiones: 1000, cobrado: 6000, ingresos_sin_desglose: 2 };
  db.resumenPanel = async tipo => { consultas.push(tipo); return resumen; };
  db.listarAgendaPanel = db.listarRealizados = async () => assert.fail('El resumen no debe consultar tablas ni vistas');
  const servidor = app.listen(0, '127.0.0.1');
  await new Promise(resolve => servidor.once('listening', resolve));
  const base = 'http://127.0.0.1:' + servidor.address().port;
  try {
    const anonimo = await fetch(base + '/admin/resumen');
    assert.equal(anonimo.status, 401);
    assert.equal(anonimo.headers.get('cache-control'), 'no-store');
    assert.equal(consultas.length, 0);
    for (const password of ['isolated-admin-test', 'isolated-assistant-test']) {
      const login = await fetch(base + '/admin/login', { method: 'POST', redirect: 'manual',
        headers: { Origin: base }, body: new URLSearchParams({ password }) });
      const cookie = login.headers.get('set-cookie').split(';')[0];
      for (const tipo of ['trabajo', 'lectura', 'todos']) {
        const r = await fetch(base + '/admin/resumen?tipo=' + tipo + '&estado=rechazado&buscar=sincoincidencias&adelanto=si',
          { headers: { Cookie: cookie } });
        assert.equal(r.status, 200);
        assert.equal(r.headers.get('cache-control'), 'no-store');
        assert.match(r.headers.get('vary'), /Cookie/);
        assert.deepEqual(await r.json(), { ok: true, tipo, resumen });
        assert.equal(consultas.at(-1), tipo);
      }
    }
  } finally {
    Object.assign(db, previas);
    await new Promise(resolve => servidor.close(resolve));
  }
});

test('Comprobación de agenda: sesión obligatoria, filtros acotados y respuesta privada sin recargar el panel', async () => {
  // Este proceso usa exclusivamente la aplicación aislada y credenciales sintéticas.
  process.env.ADMIN_PASSWORD = 'isolated-admin-test';
  process.env.ASSISTANT_PASSWORD = 'isolated-assistant-test';
  process.env.SESSION_SECRET = 'isolated-session-test-not-a-live-secret';
  process.env.NODE_ENV = 'test';
  const { app } = require('./helpers/admin-fixture.cjs');
  const db = require('../lib/db');
  const llamadas = [];
  db.listarAgendaPanel = async opciones => {
    llamadas.push(opciones);
    return { cambios: true, caducada: false };
  };
  const servidor = app.listen(0, '127.0.0.1');
  await new Promise(resolve => servidor.once('listening', resolve));
  const base = 'http://127.0.0.1:' + servidor.address().port;
  try {
    const ruta = '/admin?comprobar_agenda=1&vista=11111111-1111-4111-8111-111111111111&tipo=lectura&estado=agendado&buscar=urgente&sesion=ajena';
    const anonima = await fetch(base + ruta);
    assert.equal(anonima.status, 401);
    assert.equal(anonima.headers.get('cache-control'), 'no-store');
    assert.equal(llamadas.length, 0);
    for (const password of ['isolated-admin-test', 'isolated-assistant-test']) {
      const login = await fetch(base + '/admin/login', {
        method: 'POST', redirect: 'manual', headers: { Origin: base },
        body: new URLSearchParams({ password }),
      });
      assert.equal(login.status, 302);
      const respuesta = await fetch(base + ruta, { headers: { Cookie: login.headers.get('set-cookie').split(';')[0] } });
      assert.equal(respuesta.status, 200);
      assert.equal(respuesta.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await respuesta.json(), { cambios: true, caducada: false });
      const opciones = llamadas.at(-1);
      assert.equal(opciones.comprobar, true);
      assert.equal(opciones.tipo, 'lectura');
      assert.equal(opciones.estado, 'agendado');
      assert.equal(opciones.buscar, 'urgente');
      assert.ok(opciones.sesion && opciones.sesion !== 'ajena', 'La identidad procede de la sesión, no de la URL');
    }
    assert.notEqual(llamadas[0].sesion, llamadas[1].sesion);
  } finally {
    servidor.closeAllConnections();
    await new Promise(resolve => servidor.close(resolve));
  }
});
