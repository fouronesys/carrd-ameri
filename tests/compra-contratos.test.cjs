'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const { navegador } = require('./helpers/navegador-compra.cjs');
const { cargarEstaticos } = require('../lib/catalogo-compra');

if (process.env.COMPRA_CONTRATOS_AISLADOS !== '1') {
  test('Contratos de compra en PostgreSQL desechable', { timeout: 90000 }, async () => {
    const child = spawn(process.execPath, ['scripts/test-contratos.cjs'], { stdio: 'inherit' });
    const [code] = await once(child, 'exit');
    assert.equal(code, 0);
  });
} else {
  test('Contrato navegador → HTTP → PostgreSQL de catálogo y compras', { timeout: 60000 }, async t => {
    assert.equal(process.env.NODE_ENV, 'test');
    assert.equal(new URL(process.env.POSTGRES_URL).hostname, '127.0.0.1');
    assert.match(process.env.DATA_DIR, /fresa-contratos-/);
    const db = require('../lib/db');
    const session = require('express-session');
    const id = require.resolve('connect-pg-simple');
    require.cache[id] = { id, filename: id, loaded: true, exports: () => session.MemoryStore };
    // Fallar, no simplemente simular éxito, si una compra intenta mandar correo.
    const mailId = require.resolve('../lib/mailer');
    const correos = [];
    require.cache[mailId] = { id: mailId, filename: mailId, loaded: true, exports: new Proxy({}, {
      get: (_, nombre) => async () => { correos.push(nombre); throw new Error('Correo prohibido en contratos'); },
    }) };
    const fetchLocal = global.fetch;
    const externas = [];
    let url, http;
    global.fetch = (destino, options) => {
      if (!url || new URL(destino).origin !== url) {
        externas.push(String(destino));
        throw new Error('Red externa prohibida');
      }
      return fetchLocal(destino, options);
    };
    const browsers = [];
    const cobro = base => Math.ceil((base + 700 * 1.19) / (1 - 0.0265 * 1.19));
    const firma = (ref, total) => crypto.createHash('sha256')
      .update(ref + String(total * 100) + 'COPcontratos-integridad-sintetica').digest('hex');
    async function request(ruta, options) {
      return global.fetch(url + ruta, { ...options, headers: { Origin: url, ...options?.headers } });
    }
    async function post(ruta, campos) {
      const body = new FormData();
      for (const [key, value] of Object.entries(campos)) body.append(key, String(value));
      const res = await request(ruta, { method: 'POST', body });
      return { status: res.status, data: await res.json() };
    }
    function booking(item, cambios = {}) {
      return {
        catalogo_id: item.id || '', producto: item.nombre,
        precio_cop: item.precio_cop, precio_usd: item.precio_usd || '',
        cliente_nombre: 'Cliente sintético', contacto: 'contacto de prueba',
        objetivo_nombre: 'Persona sintética', metodo: 'wompi',
        ...(item.tipo === 'extra' ? { tipo: 'extra', info_extra: 'Hechizo de prueba' } : {}),
        ...cambios,
      };
    }
    function cartItem(item, cambios = {}) {
      return {
        catalogo_id: item.id || '', nombre: item.nombre,
        precio_cop: item.precio_cop, precio_usd: item.precio_usd || '',
        es_hechizo: item.tipo === 'hechizo', hechizo_clave: item.clave || '',
        es_extra: item.tipo === 'extra', es_adelanto: false,
        objetivo_nombre: 'Persona sintética', info_extra: 'Hechizo de prueba', ...cambios,
      };
    }
    const checkout = items => post('/api/checkout', {
      cliente_nombre: 'Cliente sintético', contacto: 'contacto de prueba', items: JSON.stringify(items),
    });
    async function count() { return (await db.listarAgendamientos()).length; }
    async function rechaza(ruta, campos) {
      const antes = await count();
      const res = await post(ruta, campos);
      assert.equal(res.status, 400, JSON.stringify(res));
      assert.ok(res.data.error);
      assert.equal(await count(), antes, 'Un rechazo no debe dejar compras parciales');
    }
    try {
      await db.init();
      // El administrador permite hechizos y lecturas; los extras pertenecen
      // al catálogo original de aclaraciones.
      const dinamicos = ['hechizo', 'lectura'].map((tipo, i) => ({
        id: 'CONTRATO-' + tipo, tipo, activo: true, orden: i,
        nombre: ('✦ ' + tipo + ' dinámico & decorado ' + 'nombre largo '.repeat(9)).trim(),
        descripcion: 'Servicio sintético', clave: tipo === 'hechizo' ? 'contrato-hechizo' : '',
        precio_cop: 50000 + i * 10000, precio_usd: 12.5 + i,
      }));
      for (const item of dinamicos) await db.guardarCatalogoItem(item);
      const { app } = require('../server');
      http = app.listen(0, '127.0.0.1');
      await once(http, 'listening');
      url = 'http://127.0.0.1:' + http.address().port;
      const html = await (await request('/')).text();
      const estaticos = [...cargarEstaticos(require('node:fs').readFileSync(require.resolve('../index.html'), 'utf8')).values()];

      await t.test('Todos los botones originales y dinámicos conservan identidad, COP y USD al añadir al carrito', async () => {
        const b = await navegador(url, html, request);
        browsers.push(b);
        const fichas = [...b.document.querySelectorAll('.p')].filter(p => p.querySelector('.carrito'));
        assert.ok(fichas.length >= estaticos.length);
        // No se reimplementa el parser del cliente: los botones llaman FresaCart.add.
        for (const ficha of fichas) {
          b.click(ficha.querySelector('.carrito'));
        }
        const guardados = b.carrito();
        assert.equal(guardados.length, estaticos.length + dinamicos.length);
        for (const item of [...estaticos, ...dinamicos]) {
          const guardado = guardados.find(it => it.nombre === item.nombre && it.precio_cop === item.precio_cop);
          assert.ok(guardado, item.nombre);
          assert.equal(Number(guardado.precio_usd), Number(item.precio_usd));
          assert.equal(guardado.catalogo_id, item.id || '');
          assert.equal(guardado.es_hechizo, item.tipo === 'hechizo');
          assert.equal(guardado.hechizo_clave, item.tipo === 'hechizo' ? item.clave : '');
          assert.equal(guardado.es_extra, item.tipo === 'extra');
        }
        b.click('fc-fab-cart');
        b.click('fc-ir-checkout');
        b.valor('fc-cliente-nombre', 'Cliente sintético');
        b.valor('fc-contacto', 'contacto sintético');
        for (const campo of b.document.querySelectorAll('[data-campo]')) {
          if (campo.getAttribute('data-campo') === 'objetivo_nombre') campo.value = 'Persona sintética';
          if (campo.getAttribute('data-campo') === 'info_extra') campo.value = 'Hechizo sintético';
        }
        // Se inspecciona el payload real mediante checkout por lotes en las
        // pruebas siguientes; aquí el carrito completo supera el límite de 30.
        assert.ok(b.document.querySelectorAll('.fc-svc').length > 30);
        for (const item of dinamicos) {
          assert.ok(b.document.getElementById('fc-overlay').textContent.includes(item.nombre), item.tipo);
        }
      });

      await t.test('Compra individual real: fichas estáticas y dinámicas, extras y nombres largos', async () => {
        for (const item of [...estaticos, ...dinamicos]) {
          const b = await navegador(url, html, request);
          try {
            const fichas = [...b.document.querySelectorAll('.p')];
            const ficha = item.id
              ? fichas.find(p => p.getAttribute('data-catalogo-id') === item.id)
              : fichas.find(p => {
                const btn = p.querySelector('.wm-pay-btn');
                return !p.getAttribute('data-catalogo-id') && btn?.getAttribute('aria-label') === 'Pagar ' + item.nombre &&
                  p.textContent.includes(item.precio_cop.toLocaleString('es-CO'));
              });
            assert.ok(ficha, item.nombre);
            b.click(ficha.querySelector('.wm-pay-btn'));
            b.valor('wm-cliente', 'Cliente sintético');
            b.valor('wm-contacto', 'contacto sintético');
            b.valor('wm-obj-nombre', 'Persona sintética');
            if (item.tipo === 'extra') b.valor('wm-extra-h1', 'Hechizo sintético');
            b.document.getElementById('wm-acepto').checked = true;
            b.document.getElementById('wm-acepto').dispatchEvent(new b.document.defaultView.Event('change'));
            b.click('wm-btn-pagar');
            await b.listo();
            const res = b.solicitudes.find(r => r.ruta === '/api/booking');
            assert.ok(res, item.nombre + ': formulario enviado');
            assert.equal(res.status, 200, item.nombre + ': ' + JSON.stringify(res.data));
            assert.equal(res.data.precio_cop, cobro(item.precio_cop));
            const reg = await db.obtenerPorRef(res.data.ref);
            assert.equal(reg.producto, item.nombre);
            assert.equal(reg.estado, 'pendiente_pago');
            assert.equal(res.data.signature, firma(res.data.ref, res.data.precio_cop));
            // Solo se captura la URL; ningún motor abre el checkout externo.
            const destino = new URL(b.location.href);
            assert.equal(destino.origin, 'https://checkout.wompi.co');
            assert.equal(Number(destino.searchParams.get('amount-in-cents')), res.data.precio_cop * 100);
            assert.equal(destino.searchParams.get('signature:integrity'), res.data.signature);
          } finally { b.cerrar(); }
        }
      });

      await t.test('Carrito real serializa extras e identificadores y cobra una comisión por pedido', async () => {
        for (const items of [
          dinamicos,
          ...Array.from({ length: Math.ceil(estaticos.length / 20) }, (_, i) => estaticos.slice(i * 20, i * 20 + 20)),
        ]) {
          const b = await navegador(url, html, request);
          try {
            // Los artículos entran por sus botones, pasan por sanitizar y
            // enviarCheckout de cart.js, no por un payload construido por el test.
            for (const item of items) {
              const ficha = [...b.document.querySelectorAll('.p')].find(p => item.id
                ? p.getAttribute('data-catalogo-id') === item.id
                : !p.getAttribute('data-catalogo-id') && p.querySelector('.wm-pay-btn')?.getAttribute('aria-label') === 'Pagar ' + item.nombre &&
                  p.textContent.includes(item.precio_cop.toLocaleString('es-CO')));
              b.click(ficha.querySelector('.carrito'));
            }
            b.click('fc-fab-cart');
            b.click('fc-ir-checkout');
            b.valor('fc-cliente-nombre', 'Cliente sintético');
            b.valor('fc-contacto', 'contacto sintético');
            for (const campo of b.document.querySelectorAll('[data-campo]')) {
              if (campo.getAttribute('data-campo') === 'objetivo_nombre') campo.value = 'Persona sintética';
              if (campo.getAttribute('data-campo') === 'info_extra') campo.value = 'Hechizo sintético';
            }
            b.click('fc-siguiente'); b.click('fc-siguiente'); b.click('fc-pagar');
            await b.listo();
            const res = b.solicitudes.find(r => r.ruta === '/api/checkout');
            assert.ok(res, 'Carrito enviado');
            assert.equal(res.status, 200, JSON.stringify(res.data));
            const total = cobro(items.reduce((s, it) => s + it.precio_cop, 0));
            assert.equal(res.data.total_cop, total);
            assert.equal(res.data.signature, firma(res.data.pedido_ref, total));
            const registros = await db.obtenerPorPedido(res.data.pedido_ref);
            assert.equal(registros.length, items.length);
            registros.forEach((reg, i) => {
              assert.equal(reg.producto, items[i].nombre);
              assert.equal(reg.precio_cop, items[i].precio_cop);
              assert.equal(reg.pedido_total_cop, total);
            });
            assert.equal(Number(new URL(b.location.href).searchParams.get('amount-in-cents')), total * 100);
          } finally { b.cerrar(); }
        }
      });

      await t.test('Descuentos de fecha/código solo en hechizos; no se suman ni se confía en flags', async () => {
        await db.crearPromo({ id: 'FECHA', activa: true, objetivo: 'todos', porcentaje: 20 });
        await db.crearCodigo({ id: 'CODIGO', codigo: 'PRUEBA', activo: true, objetivo: 'todos', porcentaje: 30 });
        const hechizoOriginal = estaticos.find(i => i.tipo === 'hechizo');
        const b = await navegador(url, html, request);
        try {
          const ficha = [...b.document.querySelectorAll('.p')].find(p =>
            p.querySelector('.wm-pay-btn')?.getAttribute('aria-label') === 'Pagar ' + hechizoOriginal.nombre &&
            p.textContent.includes(hechizoOriginal.precio_cop.toLocaleString('es-CO')));
          assert.ok(ficha.querySelector('.wm-promo-badge').textContent.includes('20%'));
          b.click(ficha.querySelector('.wm-pay-btn'));
          b.valor('wm-cliente', 'Cliente sintético');
          b.valor('wm-contacto', 'contacto sintético');
          b.valor('wm-obj-nombre', 'Persona sintética');
          b.valor('wm-codigo', 'PRUEBA');
          b.click('wm-codigo-btn');
          await b.listo();
          assert.equal(b.solicitudes.find(r => r.ruta === '/api/codigo').data.porcentaje, 30);
          b.document.getElementById('wm-acepto').checked = true;
          b.document.getElementById('wm-acepto').dispatchEvent(new b.document.defaultView.Event('change'));
          b.click('wm-btn-pagar');
          await b.listo();
          const res = b.solicitudes.find(r => r.ruta === '/api/booking');
          assert.ok(res, 'Compra con código enviada');
          assert.equal(res.status, 200);
          assert.equal(res.data.precio_cop, cobro(Math.round(hechizoOriginal.precio_cop * 0.7)));
          const reg = await db.obtenerPorRef(res.data.ref);
          assert.equal(reg.codigo_promo, 'PRUEBA');
          assert.equal(reg.descuento_pct, 30);
        } finally { b.cerrar(); }
        for (const item of [...dinamicos, ...['hechizo', 'lectura', 'extra'].map(tipo => estaticos.find(i => i.tipo === tipo))]) {
          const esHechizo = item.tipo === 'hechizo';
          const res = await post('/api/booking', booking(item, {
            es_hechizo: '1', hechizo_clave: dinamicos[0].clave, codigo: 'PRUEBA', descuento_pct: '100',
          }));
          assert.equal(res.status, 200, JSON.stringify(res.data));
          assert.equal(res.data.precio_cop, cobro(Math.round(item.precio_cop * (esHechizo ? 0.7 : 1))));
          const reg = await db.obtenerPorRef(res.data.ref);
          assert.equal(Number(reg.descuento_pct || 0), esHechizo ? 30 : 0);
          const pedido = await checkout([cartItem(item, {
            es_hechizo: true, hechizo_clave: dinamicos[0].clave, codigo: 'PRUEBA', descuento_pct: 100,
            es_extra: !esHechizo,
          })]);
          assert.equal(pedido.status, 200);
          assert.equal(pedido.data.total_cop, cobro(Math.round(item.precio_cop * (esHechizo ? 0.8 : 1))));
        }
        const lectura = dinamicos[1];
        await rechaza('/api/booking', booking(lectura, { incluye_adelanto: '1', es_hechizo: '1', hechizo_clave: dinamicos[0].clave }));
        await rechaza('/api/booking', booking(lectura, { tipo: 'extra' }));
        await rechaza('/api/booking', booking(lectura, { adelanto: 'solo', tipo: 'extra', info_extra: 'Hechizo' }));
        await rechaza('/api/checkout', {
          cliente_nombre: 'Prueba', contacto: 'Prueba',
          items: JSON.stringify([cartItem(lectura, { es_adelanto: true })]),
        });
      });

      await t.test('Adelantos legítimos mantienen el precio fijo; el recargo se suma después del descuento', async () => {
        const fijo = { nombre: 'Adelanto (urgencia)', tipo: 'extra', precio_cop: 28000, precio_usd: 10 };
        const individual = await post('/api/booking', booking(fijo, { adelanto: 'solo' }));
        assert.equal(individual.status, 200);
        assert.equal(individual.data.precio_cop, cobro(28000));
        const pedido = await checkout([cartItem(fijo, { es_adelanto: true })]);
        assert.equal(pedido.status, 200);
        assert.equal(pedido.data.total_cop, cobro(28000));
        const incluido = await post('/api/booking', booking(dinamicos[0], { incluye_adelanto: '1' }));
        assert.equal(incluido.status, 200);
        assert.equal(incluido.data.precio_cop, cobro(40000 + 28000));
        const reg = await db.obtenerPorRef(incluido.data.ref);
        assert.equal(reg.adelanto, 'incluido');
        assert.equal(reg.descuento_pct, 20);
        for (const cambio of [{ precio_cop: 1 }, { precio_usd: 1 }, { catalogo_id: dinamicos[0].id }]) {
          await rechaza('/api/booking', booking(fijo, { adelanto: 'solo', ...cambio }));
          await rechaza('/api/checkout', { cliente_nombre: 'Prueba', contacto: 'Prueba',
            items: JSON.stringify([cartItem(fijo, { es_adelanto: true, ...cambio })]) });
        }
      });

      await t.test('Precios/nombres alterados, servicios ocultos/eliminados y carritos obsoletos no dejan compras', async () => {
        for (const item of [dinamicos[1], estaticos.find(i => i.tipo === 'lectura')]) {
          for (const cambio of [{ precio_cop: item.precio_cop + 1 }, { precio_usd: item.precio_usd + 1 }, { producto: 'Nombre falso' }, { catalogo_id: 'BORRADO' }]) {
            await rechaza('/api/booking', booking(item, cambio));
            const cambioCart = cambio.producto ? { nombre: cambio.producto } : cambio;
            await rechaza('/api/checkout', { cliente_nombre: 'Prueba', contacto: 'Prueba',
              items: JSON.stringify([cartItem(dinamicos[0]), cartItem(item, cambioCart)]) });
          }
        }
        const item = dinamicos[1];
        for (const cambio of [{ precio_cop: item.precio_cop + 1000 }, { precio_cop: item.precio_cop, activo: false }]) {
          await db.actualizarCatalogoItem(item.id, cambio);
          await rechaza('/api/booking', booking(item));
          await rechaza('/api/checkout', { cliente_nombre: 'Prueba', contacto: 'Prueba', items: JSON.stringify([cartItem(item)]) });
          if (cambio.activo === false) {
            assert.ok(!(await (await request('/')).text()).includes('data-catalogo-id="' + item.id + '"'));
          } else {
            const actualizado = await post('/api/booking', booking({ ...item, ...cambio }));
            assert.equal(actualizado.status, 200);
            assert.equal(actualizado.data.precio_cop, cobro(cambio.precio_cop));
          }
        }
        await db.eliminarCatalogoItem(item.id);
        await rechaza('/api/booking', booking(item));
        await rechaza('/api/checkout', { cliente_nombre: 'Prueba', contacto: 'Prueba', items: JSON.stringify([cartItem(item)]) });
        const publico = await (await request('/')).text();
        assert.ok(!publico.includes('data-catalogo-id="' + item.id + '"'));
      });
      assert.deepEqual(correos, [], 'No enviar correos');
      assert.deepEqual(externas, [], 'No consultar Wompi ni otros destinos');
    } finally {
      browsers.forEach(b => b.cerrar());
      global.fetch = fetchLocal;
      if (http) { http.closeAllConnections(); await new Promise(r => http.close(r)); }
      await db.cerrar();
    }
  });
}
