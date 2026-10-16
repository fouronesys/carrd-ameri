'use strict';

// Este comando nunca hereda credenciales ni conecta con el PostgreSQL del proyecto.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fresa-contratos-'));
  const pgdir = path.join(tmp, 'pg');
  const env = { PATH: process.env.PATH, HOME: tmp, LANG: 'C.UTF-8' };
  let child;
  function pg(cmd, args) {
    const r = spawnSync(cmd, args, { env, encoding: 'utf8' });
    if (r.error || r.status !== 0) {
      throw new Error(`${cmd}: ${r.error?.message || r.stderr || r.stdout}. Se requiere PostgreSQL local (initdb/pg_ctl); no se usará una base externa.`);
    }
  }
  const detener = signal => child?.kill(signal);
  process.on('SIGTERM', detener);
  process.on('SIGINT', detener);
  try {
    const probe = net.createServer().listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    pg('initdb', ['-D', pgdir, '-A', 'trust', '-U', 'test', '--no-locale']);
    pg('pg_ctl', ['-D', pgdir, '-l', path.join(tmp, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -k ${tmp}`, '-w', 'start']);
    child = spawn(process.execPath, ['--test', 'tests/compra-contratos.test.cjs'], {
      cwd: path.resolve(__dirname, '..'), stdio: 'inherit',
      env: {
        ...env, NODE_ENV: 'test', COMPRA_CONTRATOS_AISLADOS: '1',
        POSTGRES_URL: `postgresql://test@127.0.0.1:${port}/postgres`,
        DATA_DIR: path.join(tmp, 'data'), PGSSL: 'false',
        SESSION_SECRET: 'contratos-session-sintetica',
        WOMPI_INTEGRITY_SECRET: 'contratos-integridad-sintetica',
      },
    });
    const [code, signal] = await once(child, 'exit');
    child = null;
    process.exitCode = signal ? 1 : code;
  } finally {
    process.off('SIGTERM', detener);
    process.off('SIGINT', detener);
    try {
      if (fs.existsSync(path.join(pgdir, 'postmaster.pid'))) {
        pg('pg_ctl', ['-D', pgdir, '-m', 'immediate', '-w', 'stop']);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
