'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { once } = require('node:events');
const { spawnSync } = require('node:child_process');
const { parseHTML } = require('linkedom');
const ingresos = require('../lib/ingresos');

test('Ingresos HTTP y PostgreSQL aislados: cotización, desglose, confirmación y ajustes', { timeout: 60000 }, async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ingresos-'));
  const pgdir = path.join(tmp, 'pg');
  const env = { PATH: process.env.PATH, HOME: tmp, LANG: 'C.UTF-8' };
  const ejecutar = (cmd, args) => {
    const r = spawnSync(cmd, args, { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr || r.stdout);
  };
  const probe = net.createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(r => probe.close(r));
  let db, http, started = false;
  const realFetch = global.fetch;
  try {
    ejecutar('initdb', ['-D', pgdir, '-A', 'trust', '-U', 'test', '--no-locale']);
    ejecutar('pg_ctl', ['-D', pgdir, '-l', path.join(tmp, 'pg.log'), '-o', `-h 127.0.0.1 -p ${port} -k ${tmp}`, '-w', 'start']);
    started = true;
    Object.assign(process.env, {
      POSTGRES_URL: `postgresql://test@127.0.0.1:${port}/postgres`, DATABASE_URL: '', PGSSL: 'false',
      DATA_DIR: path.join(tmp, 'data'), NODE_ENV: 'test',
      ADMIN_PASSWORD: 'admin-ingresos-aislado', SESSION_SECRET: 'sesion-ingresos-sintetica',
      WOMPI_PUBLIC_KEY: 'pub_test_sintetica', WOMPI_PRIVATE_KEY: 'prv_test_sintetica',
      WOMPI_INTEGRITY_SECRET: 'integridad-ingresos-sintetica',
    });
    db = require('../lib/db');
    await db.init();
    const sustituir = (nombre, exports) => {
      const id = require.resolve(nombre);
      require.cache[id] = { id, filename: id, loaded: true, exports };
    };
    sustituir('connect-pg-simple', () => require('express-session').MemoryStore);
    sustituir('../lib/mailer', new Proxy({}, { get: () => async () => ({ enviado: false }) }));
    const { app, confirmarPagoRef, confirmarPagoPedido } = require('../server');
    http = app.listen(0, '127.0.0.1');
    await once(http, 'listening');
    const url = 'http://127.0.0.1:' + http.address().port;
    const txs = new Map();
    global.fetch = async (destino, options) => {
      const u = new URL(destino);
      if (u.origin === url) return realFetch(destino, options);
      assert.equal(u.origin, 'https://sandbox.wompi.co', 'No se permite red externa');
      return new Response(JSON.stringify({ data: txs.get(u.pathname.split('/').pop()) }));
    };
    const request = (ruta, body, cookie = '') => global.fetch(url + ruta, {
      method: 'POST', redirect: 'manual', headers: { Origin: url, Cookie: cookie }, body,
    });
    const login = await request('/admin/login', new URLSearchParams({ password: 'admin-ingresos-aislado' }));
    assert.equal(login.status, 302);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const post = async (ruta, data, archivos = false) => {
      const body = archivos ? new FormData() : new URLSearchParams();
      for (const [k, v] of Object.entries(data)) body.set(k, String(v));
      if (archivos) body.set('comprobante', new Blob([Buffer.from('imagen-aislada')], { type: 'image/png' }), 'prueba.png');
      const r = await request(ruta, body);
      const json = await r.json();
      assert.equal(r.status, 200, JSON.stringify(json));
      return json;
    };
    const actor = { rol: 'admin', usuario: 'fixture', usuario_id: 'fixture' };
    await db.guardarCatalogoItem({ id: 'ing-trabajo', nombre: 'Trabajo sintético', precio_cop: 2500,
      precio_usd: 1, tipo: 'hechizo', activo: true, clave: 'ing-trabajo' }, actor);
    await db.guardarCatalogoItem({ id: 'ing-lectura', nombre: 'Lectura sintética', precio_cop: 3500,
      precio_usd: 2, tipo: 'lectura', activo: true }, actor);
    const item = (lectura = false) => ({
      catalogo_id: lectura ? 'ing-lectura' : 'ing-trabajo', nombre: lectura ? 'Lectura sintética' : 'Trabajo sintético',
      precio_cop: lectura ? 3500 : 2500, precio_usd: lectura ? 2 : 1,
      objetivo_nombre: 'Persona sintética', info_extra: 'Información sintética',
    });
    async function compra(items, carrito = false, metodo = 'wompi') {
      const qr = await global.fetch(url + '/api/cotizacion', {
        method: 'POST', headers: { Origin: url, 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, metodo, divisa: 'COP' }),
      });
      const q = await qr.json();
      assert.equal(qr.status, 200, JSON.stringify(q));
      const i = items[0];
      const r = await post(carrito ? '/api/checkout' : '/api/booking', {
        cliente_nombre: 'Comprador sintético', contacto: 'Contacto sintético', metodo, cotizacion: q.token,
        ...(carrito ? { items: JSON.stringify(items) } : {
          catalogo_id: i.catalogo_id || '', producto: i.nombre, precio_cop: i.precio_cop, precio_usd: i.precio_usd,
          objetivo_nombre: i.objetivo_nombre || '', info_extra: i.info_extra || 'Hechizo sintético asociado',
          incluye_adelanto: i.incluye_adelanto ? '1' : '', adelanto: i.es_adelanto ? 'solo' : '',
        }),
      }, metodo === 'transferencia');
      const registros = carrito ? await db.obtenerPorPedido(r.pedido_ref) : [await db.obtenerPorRef(r.ref)];
      assert.deepEqual(registros.map(x => x.finanzas_compra), q.items.map((_, n) => ingresos.desdeCotizacion(q, n)));
      assert.equal(registros.reduce((s, x) => s + x.finanzas_compra.cobrado_cop, 0), q.total_cop);
      assert.equal(registros.reduce((s, x) => s + x.finanzas_compra.servicios_cop, 0), q.subtotal_cop);
      return { r, q, registros, ref: r.pedido_ref || r.ref, carrito, metodo };
    }
    async function confirmar(c) {
      if (c.metodo === 'transferencia') {
        const r = await request('/admin/aprobar/' + c.registros[0].ref, new URLSearchParams(), cookie);
        assert.equal(r.status, 302);
      } else {
        txs.set(c.ref, { id: c.ref, reference: c.ref, currency: 'COP',
          amount_in_cents: c.q.total_cop * 100, status: 'APPROVED' });
        const fn = c.carrito ? confirmarPagoPedido : confirmarPagoRef;
        assert.equal((await fn(c.ref, c.ref)).agendado, true);
        assert.equal((await fn(c.ref, c.ref)).yaAgendado, true);
      }
    }
    const resumen = async tipo => {
      const r = await db.resumenPanel(tipo);
      const filas = (await db.pool.query('SELECT data FROM agendamientos')).rows.map(x => x.data)
        .filter(x => !tipo || tipo === 'todos' || require('../lib/tipo-servicio').tipoServicio(x) === tipo);
      const esperado = ingresos.resumir(filas);
      for (const k of Object.keys(esperado)) assert.equal(Number(r[k]), esperado[k], k);
      return esperado;
    };
    await t.test('Individual y carrito equivalentes aportan 2500, no 3442; pendientes no suman', async () => {
      const a = await compra([item()]), b = await compra([item()], true);
      assert.equal(a.q.total_cop, 3442);
      assert.equal((await resumen()).ingresos, 0);
      for (const c of [a, b]) await confirmar(c);
      assert.deepEqual(await resumen(), { ingresos: 5000, comisiones: 1884, cobrado: 6884, ingresos_sin_desglose: 0 });
    });
    await t.test('Descuentos, urgencia incluida, adelanto independiente, transferencia y tipos mixtos', async () => {
      await db.crearPromo({ id: 'promo-ingresos', activa: true, porcentaje: 20, objetivo: ['ing-trabajo'] });
      const a = await compra([{ ...item(), incluye_adelanto: true }]);
      assert.equal(a.q.items[0].cop, 30000);
      const b = await compra([item()]);
      const c = await compra([item()], true);
      assert.equal(b.q.items[0].cop, 2000);
      for (const x of [a, b, c]) await confirmar(x);
      const adelanto = await compra([{ nombre: 'Adelanto (urgencia)', precio_cop: 28000, precio_usd: 10, es_adelanto: true }]);
      await confirmar(adelanto);
      const mixto = await compra([item(), item(true)], true);
      await confirmar(mixto);
      const antes = await resumen();
      const transferencia = await compra([item(), item(true)], true, 'transferencia');
      assert.deepEqual(await resumen(), antes, 'Comprobante pendiente no suma');
      await confirmar(transferencia);
      assert.equal((await resumen()).ingresos - antes.ingresos, 5500);
      assert.equal((await resumen()).comisiones, antes.comisiones, 'Transferencia no tiene comisión');
      const total = await resumen(), trabajos = await resumen('trabajo'), lecturas = await resumen('lectura');
      for (const k of ['ingresos', 'comisiones', 'cobrado']) assert.equal(total[k], trabajos[k] + lecturas[k]);
      for (const tipo of ['todos', 'trabajo', 'lectura']) {
        const esperado = await resumen(tipo);
        for (const estado of ['agendado', 'rechazado']) {
          const d = parseHTML(await (await global.fetch(url + '/admin?tipo=' + tipo + '&estado=' + estado,
            { headers: { Cookie: cookie } })).text()).document;
          assert.equal(d.querySelector('#stat-ingresos').textContent, '$' + esperado.ingresos.toLocaleString('es-CO'));
        }
      }
    });
    await t.test('Ediciones antes y después del pago no cambian cobro, ingreso ni duplican pedidos', async () => {
      for (const carrito of [false, true]) for (const pagado of [false, true]) {
        const c = await compra([item()], carrito);
        if (pagado) await confirmar(c);
        const antes = c.registros[0].finanzas_compra;
        const editar = async (ruta, datos) => {
          const r = await request(ruta + c.registros[0].ref, new URLSearchParams(datos), cookie);
          assert.equal(r.status, 302, await r.text());
        };
        await editar('/admin/editar/', { precio_cop: 99999, producto: 'Nombre corregido' });
        if (!pagado) await confirmar(c);
        assert.deepEqual((await db.obtenerPorRef(c.registros[0].ref)).finanzas_compra, antes);
        await editar('/admin/servicio/', { producto: 'Ajuste sin cobro', precio_cop: 33333 });
        const filas = await db.obtenerPorPedido(c.ref);
        assert.equal(filas.length, 2);
        assert.ok(filas.every(x => x.pedido_total_cop === c.q.total_cop));
        assert.equal(ingresos.resumir(filas).ingresos, antes.servicios_cop);
      }
      await resumen();
    });
    await t.test('Históricos incompletos y malformados se identifican; realizados y papelera siguen sumando', async () => {
      const antes = await resumen();
      for (const [n, f] of [undefined, {}, { version: 1, servicios_cop: 'no' }, { version: 1, servicios_cop: '2500', comision_cop: 942, cobrado_cop: 3442 },
        { version: 1, servicios_cop: 2500, comision_cop: 1, cobrado_cop: 3442 }].entries()) {
        await db.crearAgendamiento({ ref: 'HIST-' + n, producto: 'Antiguo', estado: 'agendado', precio_cop: 3442, finanzas_compra: f });
      }
      await db.crearAgendamiento({ ref: 'RECHAZADO', estado: 'rechazado', finanzas_compra: { version: 1, servicios_cop: 2500, comision_cop: 942, cobrado_cop: 3442 } });
      await db.pool.query(`UPDATE agendamientos SET data = data || '{"trabajo_hecho":true,"eliminado_en":"2026-01-01"}'::jsonb WHERE ref NOT LIKE 'HIST-%'`);
      const despues = await resumen();
      assert.equal(despues.ingresos, antes.ingresos);
      assert.equal(despues.ingresos_sin_desglose, 5);
      const d = parseHTML(await (await global.fetch(url + '/admin?tipo=todos', { headers: { Cookie: cookie } })).text()).document;
      assert.equal(d.querySelector('#stat-sin-desglose').textContent, '5');
      assert.match(d.body.textContent, /Ingresos de servicios/);
      assert.match(d.body.textContent, /Total cobrado desglosado/);
      assert.match(d.body.textContent, /no se deduce la comisión/);
    });
  } finally {
    global.fetch = realFetch;
    if (http) { http.closeAllConnections(); await new Promise(r => http.close(r)); }
    if (db) await db.cerrar();
    if (started) ejecutar('pg_ctl', ['-D', pgdir, '-m', 'immediate', '-w', 'stop']);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
