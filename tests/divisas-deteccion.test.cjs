'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');
const { DIVISAS } = require('../lib/divisas');
const { tasasPrueba } = require('./helpers/tasas.cjs');
const source = fs.readFileSync(require.resolve('../assets/divisas.js'), 'utf8');

async function cliente({ guardada, zona = 'UTC', idiomas = ['es-CO'], sinStorage = false, sinZona = false } = {}) {
  const { document, Event, CustomEvent } = parseHTML('<html><head></head><body></body></html>');
  const escrituras = [];
  const ctx = vm.createContext({
    document, Event, CustomEvent, console, setTimeout, clearTimeout,
    navigator: { languages: idiomas, language: idiomas[0] },
    Intl: { NumberFormat: Intl.NumberFormat, DateTimeFormat() {
      if (sinZona) throw new Error('Zona no disponible');
      return { resolvedOptions: () => ({ timeZone: zona }) };
    } },
    localStorage: {
      getItem() { if (sinStorage) throw new Error('Storage bloqueado'); return guardada; },
      setItem(k, v) { if (sinStorage) throw new Error('Storage bloqueado'); escrituras.push([k, v]); },
    },
    dispatchEvent() {},
    fetch: async ruta => {
      assert.equal(ruta, '/api/divisas', 'Sin servicios de geolocalización');
      return { ok: true, json: async () => ({ tasas: tasasPrueba().rates, divisas: DIVISAS }) };
    },
  });
  vm.runInContext('window = globalThis;', ctx);
  vm.runInContext(source, ctx);
  await ctx.FresaDivisas.listo;
  return { D: ctx.FresaDivisas, escrituras };
}

test('La zona horaria detecta las once monedas aunque el navegador esté en inglés', async () => {
  const zonas = {
    COP: 'America/Bogota', USD: 'America/New_York', EUR: 'Europe/Madrid', MXN: 'America/Mexico_City',
    PEN: 'America/Lima', DOP: 'America/Santo_Domingo', ARS: 'America/Argentina/Buenos_Aires',
    BRL: 'America/Sao_Paulo', CLP: 'America/Santiago', PYG: 'America/Asuncion', VES: 'America/Caracas',
  };
  for (const [codigo, zona] of Object.entries(zonas)) {
    const { D, escrituras } = await cliente({ zona, idiomas: ['en-US'] });
    assert.equal(D.actual(), codigo, zona);
    assert.deepEqual(escrituras, [], 'No guardar la inferencia como elección manual');
  }
});

test('Una moneda guardada prevalece sobre ubicación y lenguaje, sin impedir cambiarla', async () => {
  const { D, escrituras } = await cliente({ guardada: 'EUR', zona: 'America/Bogota', idiomas: ['es-MX'] });
  assert.equal(D.actual(), 'EUR');
  D.establecer('PEN');
  assert.equal(D.actual(), 'PEN');
  assert.deepEqual(escrituras, [['fresa_divisa_v1', 'PEN']]);
  assert.equal((await cliente({ guardada: 'inventada', zona: 'America/Caracas' })).D.actual(), 'VES');
});

test('Región e idiomas de respaldo, etiquetas extendidas, alias y datos inaccesibles', async () => {
  for (const [idiomas, esperado] of [
    [['es-Latn-MX-u-nu-latn'], 'MXN'], [['en-GB', 'es-PE'], 'PEN'],
    [['pt-PT'], 'EUR'], [['pt-BR'], 'BRL'], [['es_DO'], 'DOP'], [['es-PY'], 'PYG'],
    [['es-AR'], 'ARS'], [['es-CL'], 'CLP'], [['es-VE'], 'VES'], [['fr-FR'], 'EUR'],
    [['en-US'], 'USD'], [['es-CO'], 'COP'], [['es'], 'COP'], [['en-GB'], 'COP'],
  ]) {
    assert.equal((await cliente({ idiomas, sinZona: true, sinStorage: true })).D.actual(), esperado, idiomas.join(','));
  }
  for (const [zona, moneda] of [['Mexico/General', 'MXN'], ['America/Indiana/Knox', 'USD'],
    ['America/Buenos_Aires', 'ARS'], ['Atlantic/Canary', 'EUR'], ['Pacific/Easter', 'CLP'],
    ['America/Guayaquil', 'USD']]) {
    assert.equal((await cliente({ zona })).D.actual(), moneda);
  }
});
