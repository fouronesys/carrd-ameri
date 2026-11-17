'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { once } = require('node:events');
const { spawnSync } = require('node:child_process');
const { crearProcesadorSeguimientos, plazoEntrega } = require('../lib/seguimientos');
const templates = require('../lib/templates');

test('Vencimientos con PostgreSQL aislado, reloj y correo simulados', { timeout: 60000 }, async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fresa-plazos-'));
  const pgdir = path.join(tmp, 'pg');
  const env = { PATH: process.env.PATH, HOME: tmp, LANG: 'C.UTF-8' };
  function ejecutar(cmd, args) {
    const r = spawnSync(cmd, args, { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr || r.stdout);
  }
  const socket = net.createServer().listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(r => socket.close(r));
  let db, iniciado = false;
  try {
    ejecutar('initdb', ['-D', pgdir, '-A', 'trust', '-U', 'test', '--no-locale']);
    ejecutar('pg_ctl', ['-D', pgdir, '-l', path.join(tmp, 'pg.log'),
      '-o', `-h 127.0.0.1 -p ${port} -k ${tmp}`, '-w', 'start']);
    iniciado = true;
    Object.assign(process.env, {
      POSTGRES_URL: `postgresql://test@127.0.0.1:${port}/postgres`,
      DATABASE_URL: '', PGSSL: 'false', DATA_DIR: path.join(tmp, 'data'),
    });
    db = require('../lib/db');
    await db.init();
    const base = { estado: 'agendado', cliente_id: 'C', producto: 'Servicio <prueba>',
      pagado_en: '2026-01-01T12:00:00.000Z', creado_en: '2025-12-01T12:00:00.000Z' };
    let ahora, fallo, lanzarError, mensajes, seguimientos, errores;
    const procesar = crearProcesadorSeguimientos({
      db, reloj: () => Date.parse(ahora),
      logger: { error: (...args) => errores.push(args) },
      mailer: {
        enviarAvisoEntrega: async (reg, info) => {
          if (lanzarError) throw new Error('SMTP simulado');
          mensajes.push({ reg, info, html: templates.correoAvisoEntrega(reg, info) });
          return { enviado: !fallo };
        },
        enviarSeguimiento: async (reg, tipo) => { seguimientos.push([reg.ref, tipo]); return { enviado: true }; },
      },
    });
    async function preparar(registros, fecha = '2026-01-03T12:00:00.000Z') {
      await db.pool.query('DELETE FROM agendamientos');
      for (const r of registros) await db.crearAgendamiento({ ...base, ...r });
      ahora = fecha; fallo = false; lanzarError = false; mensajes = []; seguimientos = []; errores = [];
    }
    const refs = () => mensajes.map(m => m.reg.ref);
    const vincular = (destino, anterior = '') => db.vincularAdelanto('A', destino, anterior);

    await t.test('No infiere urgencia por cuenta o pedido; incluido conserva frontera exacta de dos días', async () => {
      await preparar([{ ref: 'A', adelanto: 'solo' }, { ref: 'S' },
        { ref: 'I', adelanto: 'incluido' }, { ref: 'E', adelanto: 'extra' }], '2026-01-03T11:59:59.999Z');
      await procesar();
      assert.deepEqual(refs(), []);
      ahora = '2026-01-03T12:00:00.000Z';
      await procesar(); await procesar();
      assert.deepEqual(refs(), ['I']);
      ahora = '2026-02-05T12:00:00.000Z';
      await procesar();
      assert.deepEqual(refs(), ['I', 'S', 'E']);
      assert.equal(mensajes[1].info.conAdelanto, false);
    });

    await t.test('Solo el servicio explícito usa el último pago, con referencia y fecha correctas en correo', async () => {
      await preparar([{ ref: 'A', adelanto: 'solo', pagado_en: '2026-01-10T12:00:00.000Z' },
        { ref: 'S' }, { ref: 'OTRO' }], '2026-01-12T11:59:59.999Z');
      await vincular('S');
      await procesar(); assert.deepEqual(refs(), []);
      ahora = '2026-01-12T12:00:00.000Z';
      await procesar(); await procesar();
      assert.deepEqual(refs(), ['S']);
      assert.equal(mensajes[0].info.desde, '2026-01-10T12:00:00.000Z');
      assert.equal(mensajes[0].info.limite, '2026-01-13T12:00:00.000Z');
      assert.equal(mensajes[0].info.diasRestantes, 1);
      assert.match(mensajes[0].html, /Referencia del adelanto vinculado/);
      assert.match(mensajes[0].html, /Servicio &lt;prueba&gt;/);
      assert.match(mensajes[0].html, /último pago/);
      const reg = await db.obtenerParaSeguimiento('S');
      assert.equal(plazoEntrega({ ...reg, pagado_en: '2026-01-11T12:00:00.000Z' }).desde,
        '2026-01-11T12:00:00.000Z', 'Si el servicio se pagó después, manda ese pago');
    });

    await t.test('Reasignar y desvincular recalcula sin renovar reloj ni repetir avisos ya enviados', async () => {
      await preparar([{ ref: 'A', adelanto: 'solo' }, { ref: 'S' }, { ref: 'T' }]);
      await vincular('S'); await procesar();
      await vincular('T', 'S'); await procesar();
      assert.deepEqual(refs(), ['S', 'T']);
      assert.equal(mensajes[0].info.limite, mensajes[1].info.limite);
      await vincular('', 'T'); await procesar();
      assert.deepEqual(refs(), ['S', 'T']);
      ahora = '2026-02-05T12:00:00.000Z';
      await procesar();
      assert.deepEqual(refs(), ['S', 'T', 'S', 'T']);
      assert.equal(mensajes[2].info.conAdelanto, false);
      await vincular('S'); await procesar();
      assert.equal(mensajes.length, 4, 'Volver al mismo plazo no duplica un aviso confirmado');
    });

    await t.test('Pago pendiente, devolución, entrega, papelera y cambio de comprador desactivan el vínculo', async () => {
      for (const cambio of [{ estado: 'pendiente_pago' }, { estado: 'pendiente_verificacion' },
        { estado: 'rechazado' }, { trabajo_hecho: true }, { eliminado_en: '2026-01-02' },
        { cliente_id: 'OTRO' }]) {
        await preparar([{ ref: 'A', adelanto: 'solo' }, { ref: 'S' }]);
        await vincular('S'); await db.actualizarPorRef('A', cambio); await procesar();
        assert.deepEqual(refs(), [], JSON.stringify(cambio));
        assert.equal(plazoEntrega(await db.obtenerParaSeguimiento('S')).conAdelanto, false);
      }
      for (const cambio of [{ estado: 'rechazado' }, { trabajo_hecho: true },
        { eliminado_en: '2026-01-02' }]) {
        await preparar([{ ref: 'A', adelanto: 'solo' }, { ref: 'S' }]);
        await vincular('S'); await db.actualizarPorRef('S', cambio); await procesar();
        assert.deepEqual(refs(), []);
      }
      await preparar([{ ref: 'A', adelanto: 'solo' }, { ref: 'S' }]);
      await vincular('S');
      await db.actualizarPorRef('A', { estado: 'pendiente_pago' }); await procesar();
      await db.actualizarPorRef('A', { estado: 'agendado' }); await procesar();
      assert.deepEqual(refs(), ['S'], 'Confirmar el pago activa el plazo');
    });

    await t.test('Conserva aviso normal histórico sin silenciar urgencia; no prorroga plazo original', async () => {
      await preparar([{ ref: 'A', adelanto: 'solo', pagado_en: '2026-02-11T12:00:00.000Z' },
        { ref: 'S', aviso_entrega_en: '2026-02-05T12:00:00.000Z' }],
      '2026-02-11T12:00:00.000Z');
      await vincular('S'); await procesar();
      assert.deepEqual(refs(), ['S']);
      assert.equal(mensajes[0].info.limite, '2026-02-12T12:00:00.000Z');
      await vincular('', 'S'); await procesar();
      assert.equal(mensajes.length, 1);
    });

    await t.test('Fallo de correo no confirma envío; reintenta, avisa vencidos y rechaza fechas inválidas', async () => {
      await preparar([{ ref: 'I', adelanto: 'incluido' }, { ref: 'MAL', pagado_en: 'inválida' }]);
      fallo = true; await procesar();
      assert.equal((await db.obtenerPorRef('I')).aviso_entrega_en, undefined);
      lanzarError = true; await procesar();
      assert.equal(errores.length, 1);
      lanzarError = false; fallo = false; ahora = '2026-01-06T12:00:00.000Z';
      await procesar(); await procesar();
      assert.deepEqual(refs(), ['I', 'I']);
      assert.equal(mensajes[1].info.diasRestantes, 0);
      assert.match(mensajes[1].html, /El plazo ya venció/);
      assert.ok((await db.obtenerPorRef('I')).aviso_entrega_en);
    });

    await t.test('Relee estados antes de enviar y conserva seguimientos de servicios entregados', async () => {
      await preparar([{ ref: 'S', adelanto: 'incluido' }]);
      const listar = db.listarParaSeguimientos;
      db.listarParaSeguimientos = async () => {
        const lista = await listar();
        await db.actualizarPorRef('S', { trabajo_hecho: true, trabajo_hecho_en: ahora });
        return lista;
      };
      await procesar(); assert.deepEqual(refs(), []);
      db.listarParaSeguimientos = listar;
      ahora = '2026-06-01T12:00:00.000Z';
      await procesar(); await procesar();
      assert.deepEqual(seguimientos, [['S', '5semanas'], ['S', '4meses']]);
    });
  } finally {
    if (db) await db.cerrar();
    if (iniciado) ejecutar('pg_ctl', ['-D', pgdir, '-m', 'immediate', '-w', 'stop']);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
