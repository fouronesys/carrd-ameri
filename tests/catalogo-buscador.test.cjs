'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const filtros = require('../assets/catalogo-filtros');
const catalogo = require('../lib/catalogo');

test('El buscador no altera los servicios originales y se carga después de los pagos', () => {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  assert.equal(catalogo.analizar(html, 'hechizo').total, 83);
  assert.equal(catalogo.analizar(html, 'lectura').total, 23);
  const pago = html.indexOf('src="assets/wompi.js"');
  const reglas = html.indexOf('src="assets/catalogo-filtros.js"');
  const buscador = html.indexOf('src="assets/catalogo-buscador.js"');
  assert.ok(pago > 0 && reglas > pago && buscador > reglas);
});
test('Normalización permite búsquedas por palabras sin depender de tildes ni mayúsculas', () => {
  const texto = filtros.normalizar('✦ Sanación del Vínculo — Descripción y Amor propio');
  assert.ok(filtros.normalizar('SANACION vinculo').split(' ').every(p => texto.includes(p)));
  assert.equal(filtros.normalizar('AMOR-propio'), 'amor propio');
});
test('Los precios COP y USD se leen sin inventar conversiones', () => {
  assert.equal(filtros.precioCOP('$2.500 (1 USD)'), 2500);
  assert.equal(filtros.precioCOP('$120.000 (47 USD)'), 120000);
  assert.equal(filtros.precioUSD('$48.000 (25.50 usd)'), 25.5);
  assert.equal(filtros.precioUSD('$48.000 (25,50 USD)'), 25.5);
  assert.equal(filtros.precioUSD('$48.000'), null);
  assert.equal(filtros.precioCOP('No tiene precio'), null);
});
test('Presupuestos: enteros COP, decimales USD, cero y errores explícitos', () => {
  for (const valor of ['50.000', '50,000', '50000', '$50.000']) assert.equal(filtros.presupuesto(valor, 'cop'), 50000);
  assert.equal(filtros.presupuesto('1.000.000', 'cop'), 1000000);
  for (const valor of ['25.50', '25,50']) assert.equal(filtros.presupuesto(valor, 'usd'), 25.5);
  for (const moneda of ['cop', 'usd']) {
    assert.equal(filtros.presupuesto('', moneda), null);
    assert.equal(filtros.presupuesto('0', moneda), 0);
    for (const valor of ['-1', 'abc', 'Infinity', '1e3']) assert.ok(Number.isNaN(filtros.presupuesto(valor, moneda)));
  }
  assert.ok(Number.isNaN(filtros.presupuesto('25.5', 'cop')));
  assert.ok(Number.isNaN(filtros.presupuesto('25.555', 'usd')));
});
test('La ordenación usa la moneda elegida, conserva empates y deja precios ausentes al final', () => {
  const items = [
    { idx: 0, cop: 1000, usd: 25, clave: 'limpieza' },
    { idx: 1, cop: 50000, usd: 10, clave: 'amor' },
    { idx: 2, cop: 2500, usd: null, clave: 'vinculo' },
    { idx: 3, cop: 50000, usd: 10, clave: 'sanacion' },
  ];
  const ids = (orden, moneda) => filtros.ordenar([...items], orden, moneda).map(i => i.idx);
  assert.deepEqual(ids('asc', 'cop'), [0, 2, 1, 3]);
  assert.deepEqual(ids('desc', 'cop'), [1, 3, 2, 0]);
  assert.deepEqual(ids('asc', 'usd'), [1, 3, 0, 2]);
  assert.deepEqual(ids('desc', 'usd'), [0, 1, 3, 2]);
  assert.deepEqual(ids('az', 'cop'), [1, 0, 3, 2]);
  assert.deepEqual(ids('orig', 'cop'), [0, 1, 2, 3]);
});
