'use strict';

// PostgreSQL desechable y SMTP local: nunca usar conexiones ni destinatarios reales.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawnSync, spawn } = require('node:child_process');
const { once } = require('node:events');

const pausa = ms => new Promise(r => setTimeout(r, ms));
async function esperar(condicion) {
  for (let i = 0; i < 200; i++) {
    if (await condicion()) return;
    await pausa(20);
  }
  throw new Error('Tiempo de espera agotado');
}

function smtpSimulado() {
  const mensajes = [];
  const sockets = new Set();
  let fallo = false, demorar = false, aceptar = null;
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.write('220 localhost SMTP de prueba\r\n');
    let buffer = '', data = false, lineas = [];
    socket.on('data', chunk => {
      buffer += chunk.toString();
      let fin;
      while ((fin = buffer.indexOf('\r\n')) >= 0) {
        const linea = buffer.slice(0, fin);
        buffer = buffer.slice(fin + 2);
        if (data) {
          if (linea !== '.') { lineas.push(linea); continue; }
          data = false;
          mensajes.push(lineas.join('\r\n'));
          lineas = [];
          const responder = () => socket.write(fallo ? '451 Reintentar luego\r\n' : '250 Aceptado\r\n');
          if (demorar) aceptar = responder;
          else responder();
        } else if (/^EHLO/.test(linea)) socket.write('250-localhost\r\n250 AUTH PLAIN\r\n');
        else if (/^AUTH/.test(linea)) socket.write('235 Autenticado\r\n');
        else if (/^(MAIL|RCPT|RSET)/.test(linea)) socket.write('250 OK\r\n');
        else if (linea === 'DATA') { data = true; socket.write('354 Enviar mensaje\r\n'); }
        else if (linea === 'QUIT') socket.end('221 Adios\r\n');
      }
    });
  });
  return {
    server, mensajes,
    fallar(valor) { fallo = valor; },
    demorar(valor) { demorar = valor; },
    aceptar() { aceptar(); aceptar = null; },
    cerrar() { for (const s of sockets) s.destroy(); return new Promise(r => server.close(r)); },
  };
}

test('Cola durable: transacciones, concurrencia, caída forzada, reintentos y SMTP simulado', { timeout: 60000 }, async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fresatanika-avisos-'));
  const pgdir = path.join(tmp, 'pg');
  // No heredar secretos al servidor de pruebas.
  const env = { PATH: process.env.PATH, HOME: tmp, LANG: 'C.UTF-8' };
  function ejecutar(cmd, args) {
    const r = spawnSync(cmd, args, { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr || r.stdout);
  }
  const puertoLibre = net.createServer();
  puertoLibre.listen(0, '127.0.0.1');
  await once(puertoLibre, 'listening');
  const puerto = puertoLibre.address().port;
  await new Promise(r => puertoLibre.close(r));
  const smtp = smtpSimulado();
  let db, hijo;
  try {
    ejecutar('initdb', ['-D', pgdir, '-A', 'trust', '-U', 'test', '--no-locale']);
    ejecutar('pg_ctl', ['-D', pgdir, '-l', path.join(tmp, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${puerto} -k ${tmp}`, '-w', 'start']);
    fs.mkdirSync(path.join(tmp, 'data'));
    Object.assign(process.env, {
      POSTGRES_URL: `postgresql://test@127.0.0.1:${puerto}/postgres`,
      DATABASE_URL: '', PGSSL: 'false', DATA_DIR: path.join(tmp, 'data'),
      SMTP_HOST: '127.0.0.1', SMTP_USER: 'test@example.invalid',
      SMTP_PASS: 'synthetic-test-only', SMTP_FROM: 'test@example.invalid',
    });
    smtp.server.listen(0, '127.0.0.1');
    await once(smtp.server, 'listening');
    process.env.SMTP_PORT = String(smtp.server.address().port);
    db = require('../lib/db');
    const mailer = require('../lib/mailer');
    const { crearColaAvisos } = require('../lib/avisos-realizado');
    await db.init();
    await db.crearCliente({ id: 'TEST-CLIENT', email: 'cliente@example.invalid' });
    const enviar = (reg, to, messageId) => mailer.enviarEstadoCliente('realizado', reg, to, { messageId });
    async function crear(ref, extras = {}) {
      await db.crearAgendamiento({ ref, estado: 'agendado', cliente_id: 'TEST-CLIENT', producto: 'Prueba aislada', ...extras });
    }
    async function aviso(ref) {
      return (await db.pool.query('SELECT * FROM avisos_realizado WHERE ref = $1', [ref])).rows[0];
    }
    async function inmediato(ref) {
      await db.pool.query("UPDATE avisos_realizado SET proximo_intento = now() WHERE ref = $1", [ref]);
    }

    await t.test('La entrega y el aviso se revierten juntos si la cola no se puede guardar', async () => {
      await crear('ROLLBACK');
      await db.pool.query(`CREATE FUNCTION rechazar_aviso_test() RETURNS trigger LANGUAGE plpgsql AS
        $$ BEGIN RAISE EXCEPTION 'fallo simulado'; END $$`);
      await db.pool.query(`CREATE TRIGGER fallo_test BEFORE INSERT ON avisos_realizado
        FOR EACH ROW EXECUTE FUNCTION rechazar_aviso_test()`);
      await assert.rejects(db.marcarTrabajoRealizado('ROLLBACK'), /fallo simulado/);
      assert.equal((await db.obtenerPorRef('ROLLBACK')).trabajo_hecho, undefined);
      await db.pool.query('DROP TRIGGER fallo_test ON avisos_realizado');
    });

    await t.test('Dos instancias no envían el mismo aviso; HTTP no espera SMTP y las marcas esperan aceptación', async () => {
      await crear('CONCURRENTE');
      await Promise.all(Array.from({ length: 4 }, () => db.marcarTrabajoRealizado('CONCURRENTE')));
      assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM avisos_realizado')).rows[0].n, 1);
      smtp.demorar(true);
      const primera = db.procesarSiguienteAvisoRealizado(enviar);
      await esperar(() => smtp.mensajes.length === 1);
      assert.equal((await db.obtenerPorRef('CONCURRENTE')).cliente_aviso_realizado, undefined);
      assert.equal(await db.procesarSiguienteAvisoRealizado(enviar), false);
      const inicio = performance.now();
      await db.marcarTrabajoRealizado('CONCURRENTE');
      assert.ok(performance.now() - inicio < 1000);
      smtp.aceptar();
      smtp.demorar(false);
      await primera;
      assert.ok((await db.obtenerPorRef('CONCURRENTE')).cliente_aviso_realizado);
      assert.equal((await aviso('CONCURRENTE')).estado, 'enviado');
      await db.marcarTrabajoRealizado('CONCURRENTE');
      assert.equal(await db.procesarSiguienteAvisoRealizado(enviar), false);
      assert.equal(smtp.mensajes.length, 1);
    });

    await t.test('Un rechazo SMTP programa un reintento persistente sin marcar enviado', async () => {
      await crear('REINTENTO');
      await db.marcarTrabajoRealizado('REINTENTO');
      smtp.fallar(true);
      await db.procesarSiguienteAvisoRealizado(enviar);
      assert.equal((await db.obtenerPorRef('REINTENTO')).cliente_aviso_realizado, undefined);
      let fila = await aviso('REINTENTO');
      assert.equal(fila.intentos, 1);
      assert.equal(fila.estado, 'pendiente');
      assert.ok(fila.proximo_intento > new Date());
      assert.equal(await db.procesarSiguienteAvisoRealizado(enviar), false);
      smtp.fallar(false);
      await inmediato('REINTENTO');
      // Nueva instancia del consumidor simula el reinicio; no usa estado local.
      const cola = crearColaAvisos(db, mailer);
      await cola.despertar();
      await cola.detener();
      fila = await aviso('REINTENTO');
      assert.equal(fila.intentos, 2);
      assert.equal(fila.estado, 'enviado');
      const ids = smtp.mensajes.slice(-2).map(m => m.match(/Message-ID: (.+)/i)[1]);
      assert.equal(ids[0], ids[1]);
    });

    await t.test('Sin configuración SMTP no se pierde el aviso ni se guarda marca', async () => {
      await crear('SIN-SMTP');
      await db.marcarTrabajoRealizado('SIN-SMTP');
      process.env.SMTP_PASS = '';
      await db.procesarSiguienteAvisoRealizado(enviar);
      process.env.SMTP_PASS = 'synthetic-test-only';
      assert.equal((await aviso('SIN-SMTP')).estado, 'pendiente');
      assert.equal((await db.obtenerPorRef('SIN-SMTP')).cliente_aviso_realizado, undefined);
      await inmediato('SIN-SMTP');
      await db.procesarSiguienteAvisoRealizado(enviar);
    });

    await t.test('SIGKILL libera la reclamación y otra instancia recupera el aviso', async () => {
      await crear('CAIDA');
      await db.marcarTrabajoRealizado('CAIDA');
      hijo = spawn(process.execPath, ['-e', `
        const db = require('./lib/db');
        db.procesarSiguienteAvisoRealizado(async () => {
          process.send('reclamado');
          await new Promise(() => {});
        }).catch(() => process.exit(1));
      `], {
        cwd: path.resolve(__dirname, '..'), stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        env: { ...env, POSTGRES_URL: `postgresql://test@127.0.0.1:${puerto}/postgres`, DATA_DIR: path.join(tmp, 'data') },
      });
      await once(hijo, 'message');
      assert.equal(await db.procesarSiguienteAvisoRealizado(enviar), false);
      const salida = once(hijo, 'exit');
      hijo.kill('SIGKILL');
      await salida;
      hijo = null;
      await esperar(() => db.procesarSiguienteAvisoRealizado(enviar));
      assert.equal((await aviso('CAIDA')).estado, 'enviado');
    });

    await t.test('Invitados, marcas previas, desmarcados y borrados no generan avisos indebidos', async () => {
      for (const [ref, extras] of [
        ['INVITADO', { cliente_id: undefined }],
        ['PREVIO', { cliente_aviso_realizado: '2026-01-01' }],
        ['HEREDADO', { aviso_realizado_enviado: true }],
        ['IMPAGO', { estado: 'pendiente_pago' }],
      ]) { await crear(ref, extras); await db.marcarTrabajoRealizado(ref); assert.equal(await aviso(ref), undefined); }
      await crear('DESMARCADO');
      await db.marcarTrabajoRealizado('DESMARCADO');
      await db.actualizarPorRef('DESMARCADO', { trabajo_hecho: false });
      const antes = smtp.mensajes.length;
      await db.procesarSiguienteAvisoRealizado(enviar);
      assert.equal(smtp.mensajes.length, antes);
      await db.marcarTrabajoRealizado('DESMARCADO');
      await inmediato('DESMARCADO');
      await db.procesarSiguienteAvisoRealizado(enviar);
      assert.equal(smtp.mensajes.length, antes + 1);
      await crear('BORRADO');
      await db.marcarTrabajoRealizado('BORRADO');
      await db.eliminarPorRef('BORRADO');
      await db.procesarSiguienteAvisoRealizado(enviar);
      assert.equal((await aviso('BORRADO')).estado, 'cancelado');
      assert.equal(smtp.mensajes.length, antes + 1);
    });

    await t.test('La ruta HTTP real responde mientras SMTP sigue esperando y luego confirma el aviso', async () => {
      Object.assign(process.env, {
        ADMIN_PASSWORD: 'isolated-admin-test', ASSISTANT_PASSWORD: '',
        SESSION_SECRET: 'isolated-session-test', NODE_ENV: 'test',
      });
      const session = require('express-session');
      const id = require.resolve('connect-pg-simple');
      require.cache[id] = { id, filename: id, loaded: true, exports: () => session.MemoryStore };
      mailer.enviarAlertaLogin = async () => ({ enviado: false });
      const { app } = require('../server');
      const http = app.listen(0, '127.0.0.1');
      await once(http, 'listening');
      const url = 'http://127.0.0.1:' + http.address().port;
      try {
        const login = await fetch(url + '/admin/login', {
          method: 'POST', redirect: 'manual', headers: { Origin: url },
          body: new URLSearchParams({ password: 'isolated-admin-test' }),
        });
        assert.equal(login.status, 302);
        const cookie = login.headers.get('set-cookie').split(';')[0];
        await crear('HTTP');
        smtp.demorar(true);
        const antes = smtp.mensajes.length;
        const inicio = performance.now();
        const respuesta = await fetch(url + '/admin/trabajo/HTTP', {
          method: 'POST', headers: { Cookie: cookie, Origin: url, Accept: 'application/json' },
          body: new URLSearchParams({ accion: 'marcar' }),
        });
        assert.equal(respuesta.status, 200);
        assert.equal((await respuesta.json()).realizado, true);
        assert.ok(performance.now() - inicio < 1000);
        await esperar(() => smtp.mensajes.length === antes + 1);
        assert.equal((await aviso('HTTP')).estado, 'pendiente');
        smtp.aceptar();
        smtp.demorar(false);
        await esperar(async () => (await aviso('HTTP')).estado === 'enviado');
      } finally {
        http.closeAllConnections();
        await new Promise(r => http.close(r));
      }
    });
  } finally {
    if (hijo) { const salida = once(hijo, 'exit'); hijo.kill('SIGKILL'); await salida; }
    if (db) await db.cerrar();
    await smtp.cerrar();
    if (fs.existsSync(path.join(pgdir, 'postmaster.pid'))) ejecutar('pg_ctl', ['-D', pgdir, '-m', 'immediate', '-w', 'stop']);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
