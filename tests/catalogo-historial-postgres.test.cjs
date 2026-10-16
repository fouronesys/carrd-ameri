'use strict';

// PostgreSQL local desechable; no usar conexiones externas ni datos del catálogo real.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawnSync } = require('node:child_process');
const { once } = require('node:events');

test('Historial PostgreSQL: esquema idempotente, atomicidad, concurrencia, filtros y paginación', { timeout: 60000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogo-audit-'));
  const pgdir = path.join(tmp, 'pg');
  const env = { PATH: process.env.PATH, HOME: tmp, LANG: 'C.UTF-8' };
  const ejecutar = (cmd, args) => {
    const r = spawnSync(cmd, args, { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr || r.stdout);
  };
  const s = net.createServer().listen(0, '127.0.0.1');
  await once(s, 'listening');
  const port = s.address().port;
  await new Promise(r => s.close(r));
  let db, started = false;
  try {
    ejecutar('initdb', ['-D', pgdir, '-A', 'trust', '-U', 'test', '--no-locale']);
    ejecutar('pg_ctl', ['-D', pgdir, '-l', path.join(tmp, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -k ${tmp}`, '-w', 'start']);
    started = true;
    Object.assign(process.env, { POSTGRES_URL: `postgresql://test@127.0.0.1:${port}/postgres`, DATABASE_URL: '', PGSSL: 'false', DATA_DIR: path.join(tmp, 'data') });
    db = require('../lib/db');
    await db.init();
    await db.init();
    const actor = { rol: 'admin', usuario: 'operador', usuario_id: 'u1', password: 'no-guardar' };
    const item = { id: 'cat-prueba', nombre: 'Nombre original', precio_cop: 10000, precio_usd: 3, tipo: 'hechizo', orden: 0, activo: true, password: 'no-guardar' };
    await db.guardarCatalogoItem(item, actor);
    await db.actualizarCatalogoItem(item.id, { nombre: 'Nuevo nombre', precio_cop: 20000 }, actor);
    let history = await db.listarHistorialCatalogo({ h_accion: 'edicion', h_buscar: 'ORIGINAL' });
    assert.equal(history.eventos.length, 1);
    assert.equal(history.eventos[0].anterior.precio_cop, 10000);
    assert.equal(history.eventos[0].nuevo.precio_cop, 20000);
    assert.equal(JSON.stringify(history).includes('no-guardar'), false);
    await assert.rejects(db.guardarCatalogoItem({ ...item, id: 'sin-actor' }));
    assert.equal(await db.obtenerCatalogoPorId('sin-actor'), null);
    // Un fallo al escribir la auditoría revierte también una edición o eliminación.
    await db.pool.query(`CREATE FUNCTION rechazar_historial() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'fallo simulado'; END $$;
      CREATE TRIGGER fallo_historial BEFORE INSERT ON catalogo_historial FOR EACH ROW EXECUTE FUNCTION rechazar_historial()`);
    await assert.rejects(db.actualizarCatalogoItem(item.id, { precio_cop: 50000 }, actor), /fallo simulado/);
    await assert.rejects(db.eliminarCatalogoItem(item.id, actor), /fallo simulado/);
    assert.equal((await db.obtenerCatalogoPorId(item.id)).precio_cop, 20000);
    await db.pool.query('DROP TRIGGER fallo_historial ON catalogo_historial');
    // Dos toggles simultáneos deben registrar false -> true sin perder cambios.
    await Promise.all([1, 2].map(() => db.actualizarCatalogoItem(item.id, {}, actor, 'estado')));
    assert.equal((await db.obtenerCatalogoPorId(item.id)).activo, true);
    history = await db.listarHistorialCatalogo({});
    assert.deepEqual(history.eventos.map(e => e.accion), ['activacion', 'desactivacion', 'edicion', 'creacion']);
    assert.equal(history.eventos[0].anterior.activo, false);
    assert.equal(history.eventos[1].anterior.activo, true);
    await db.actualizarCatalogoItem(item.id, {}, actor, 'estado');
    await db.actualizarCatalogoItem(item.id, { activo: true, precio_cop: 30000 }, actor);
    assert.equal((await db.obtenerCatalogoPorId(item.id)).activo, false);
    await db.eliminarCatalogoItem(item.id, actor);
    assert.equal(await db.obtenerCatalogoPorId(item.id), null);
    assert.equal(await db.eliminarCatalogoItem(item.id, actor), null);
    const today = new Date().toISOString().slice(0, 10);
    history = await db.listarHistorialCatalogo({ h_accion: 'eliminacion', h_buscar: 'operador', h_desde: today, h_hasta: today });
    assert.equal(history.eventos.length, 1);
    assert.equal(history.eventos[0].nuevo, null);
    assert.equal(history.eventos[0].anterior.precio_cop, 30000);
    assert.equal((await db.listarHistorialCatalogo({ h_buscar: "' OR 1=1 --" })).eventos.length, 0);
    assert.equal((await db.listarHistorialCatalogo({ h_hasta: '2000-01-01' })).eventos.length, 0);
    assert.equal((await db.listarHistorialCatalogo({ h_desde: '2999-01-01' })).eventos.length, 0);
    for (let i = 0; i < 32; i++) await db.guardarCatalogoItem({ ...item, id: 'extra-' + i }, actor);
    const p1 = await db.listarHistorialCatalogo({});
    const p2 = await db.listarHistorialCatalogo({ h_pagina: '2' });
    assert.equal(p1.eventos.length, 30);
    assert.equal(p1.hayMas, true);
    assert.equal(p2.eventos.length, 9);
    assert.equal(p2.hayMas, false);
    assert.equal(new Set([...p1.eventos, ...p2.eventos].map(e => JSON.stringify(e))).size, 39);
    await db.init();
    assert.equal((await db.listarHistorialCatalogo({ h_accion: 'eliminacion' })).eventos.length, 1);
  } finally {
    if (db) await db.cerrar();
    if (started) ejecutar('pg_ctl', ['-D', pgdir, '-m', 'immediate', '-w', 'stop']);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
