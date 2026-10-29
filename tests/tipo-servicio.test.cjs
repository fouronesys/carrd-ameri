'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tipoServicio, lecturas } = require('../lib/tipo-servicio');

test('Clasifica lecturas históricas y dinámicas, respeta correcciones y no adivina por palabras del nombre', () => {
  assert.ok(lecturas.length > 10);
  assert.equal(tipoServicio({ producto: lecturas[0] }), 'lectura');
  assert.equal(tipoServicio({ producto: 'Hechizo con lectura' }), 'trabajo');
  assert.equal(tipoServicio({ catalogo_id: 'L1' }, [{ id: 'L1', tipo: 'lectura' }]), 'lectura');
  assert.equal(tipoServicio({ catalogo_id: 'L1', tipo_servicio: 'trabajo' }, [{ id: 'L1', tipo: 'lectura' }]), 'trabajo');
  assert.equal(tipoServicio({ tipo_servicio: 'lectura', producto: 'Servicio personalizado' }), 'lectura');
});
