'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { cargarEstaticos, resolverCompra } = require('../lib/catalogo-compra');
const estaticos = cargarEstaticos(fs.readFileSync(require.resolve('../index.html'), 'utf8'));
const inexistente = async () => null;

test('El catálogo original resuelve nombre y ambos precios como una identidad única', async () => {
  assert.ok(estaticos.size > 30);
  for (const tipo of ['hechizo', 'lectura', 'extra']) {
    const item = [...estaticos.values()].find(i => i.tipo === tipo);
    assert.ok(item, tipo);
    assert.deepEqual(await resolverCompra(item, estaticos, inexistente), item);
    assert.equal(await resolverCompra({ ...item, precio_cop: item.precio_cop + 1 }, estaticos, inexistente), null);
    assert.equal(await resolverCompra({ ...item, precio_usd: item.precio_usd + 1 }, estaticos, inexistente), null);
    assert.equal(await resolverCompra({ ...item, nombre: 'Nombre manipulado' }, estaticos, inexistente), null);
  }
});

test('Las banderas del cliente no convierten una lectura en hechizo ni en extra', async () => {
  const item = [...estaticos.values()].find(i => i.tipo === 'lectura');
  const resultado = await resolverCompra({ ...item, tipo: 'hechizo', es_hechizo: true, es_extra: true }, estaticos, inexistente);
  assert.equal(resultado.tipo, 'lectura');
  assert.equal(resultado.clave, '');
});

test('Los servicios dinámicos conservan nombres decorados y requieren registro activo y precios exactos', async () => {
  const item = {
    id: 'aislado', nombre: ('✦ Lectura nueva ᵎ ' + 'larga '.repeat(15)).trim(),
    tipo: 'lectura', activo: true, precio_cop: 35000, precio_usd: 8.25,
  };
  const obtener = async id => id === item.id ? item : null;
  const raw = { ...item, catalogo_id: item.id };
  assert.equal(await resolverCompra(raw, estaticos, obtener), item);
  for (const cambio of [{ catalogo_id: 'borrado' }, { precio_cop: 1000 }, { precio_usd: 1 }, { nombre: 'Otro' }]) {
    assert.equal(await resolverCompra({ ...raw, ...cambio }, estaticos, obtener), null);
  }
  item.activo = false;
  assert.equal(await resolverCompra(raw, estaticos, obtener), null);
});

test('Un servicio sin USD no admite un precio en dólares inventado', async () => {
  const item = { id: 'cop', nombre: 'Solo COP', tipo: 'hechizo', activo: true, precio_cop: 19000, precio_usd: 0 };
  const obtener = async () => item;
  const raw = { ...item, catalogo_id: item.id, precio_usd: '' };
  assert.equal(await resolverCompra(raw, estaticos, obtener), item);
  assert.equal(await resolverCompra({ ...raw, precio_usd: 4 }, estaticos, obtener), null);
});
