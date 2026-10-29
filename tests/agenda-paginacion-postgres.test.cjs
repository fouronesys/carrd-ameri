'use strict';

// Solo PostgreSQL local desechable; ninguna conexión ni correo del proyecto.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { performance } = require('node:perf_hooks');
const { claveCliente, agruparClientes } = require('../lib/agenda-clientes');
const { opcionesAgenda } = require('../lib/agenda-panel');
const templates = require('../lib/templates');

test('Normaliza filtros y limita tamaño, páginas y búsqueda desde el servidor', () => {
  assert.deepEqual(opcionesAgenda({ pagina: '-5', tamano: 999, estado: 'SQL', buscar: ['a'] }),
    { pagina: 1, tamano: 15, estado: 'todos', tipo: 'todos', buscar: '' });
  assert.equal(opcionesAgenda({ pagina: 'Infinity' }).pagina, 1);
  assert.equal(opcionesAgenda({ buscar: 'x'.repeat(500) }).buscar.length, 200);
});

test('Agenda PostgreSQL: grupos íntegros, prioridad, búsqueda global, entrega y rendimiento', { timeout: 60000 }, async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-paginacion-'));
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
    const registros = [];
    for (let n = 0; n < 47; n++) {
      for (let j = 0; j < 3; j++) {
        registros.push({
          ref: `R-${n}-${j}`, pedido_ref: `P-${n}-${j < 2 ? 0 : 1}`,
          cliente_id: `C-${n}`, cliente_nombre: 'Homónimo',
          contacto: j === 0 ? `contacto-${n}` : 'otro',
          producto: `Servicio ${j}`, creado_en: '2026-01-01T00:00:00Z',
          pagado_en: `2026-01-${String(n % 28 + 1).padStart(2, '0')}T00:00:00Z`,
          estado: n < 30 ? (j === 2 ? 'pendiente_pago' : 'agendado') : n < 40 ? 'pendiente_verificacion' : 'rechazado',
        });
      }
    }
    registros.push(
      { ref: 'INV-1', pedido_ref: 'INV', estado: 'pendiente_pago' },
      { ref: 'INV-2', pedido_ref: 'INV', estado: 'pendiente_pago' },
      { ref: 'SOLO-1', cliente_nombre: 'Homónimo', estado: 'pendiente_pago' },
      { ref: 'SOLO-2', cliente_nombre: 'Homónimo', estado: 'pendiente_pago' },
      { ref: 'HECHO', cliente_id: 'C-0', trabajo_hecho: true, estado: 'agendado' },
      { ref: 'BORRADO', cliente_id: 'C-0', eliminado_en: '2026-01-01', estado: 'agendado' },
    );
    await db.pool.query(`INSERT INTO agendamientos(ref,data)
      SELECT value->>'ref',value FROM jsonb_array_elements($1::jsonb)`, [JSON.stringify(registros)]);
    await db.pool.query(`INSERT INTO clientes(id,data) VALUES ('C-46','{"email":"unico@example.invalid"}')`);
    const resumen = await db.resumenPanel();
    assert.equal(resumen.personas_agendadas, 30);
    const vistos = new Set();
    const original = await db.pool.query(`SELECT data FROM agendamientos
      WHERE data->>'eliminado_en' IS NULL AND coalesce(data->>'trabajo_hecho','false') != 'true'
      ORDER BY CASE data->>'estado' WHEN 'agendado' THEN 0 WHEN 'pendiente_verificacion' THEN 1 ELSE 2 END,
      CASE WHEN data->>'estado' = 'agendado' THEN coalesce(nullif(data->>'pagado_en',''),data->>'creado_en') END ASC NULLS LAST,
      seq DESC`);
    const esperados = agruparClientes(original.rows.map(r => r.data)).map(g => claveCliente(g.registros[0]));
    const orden = [];
    for (let pagina = 1; pagina <= 4; pagina++) {
      const resultado = await db.listarAgendaPanel({ pagina });
      assert.equal(resultado.personas, 50);
      assert.equal(resultado.trabajos, 145);
      assert.equal(resultado.paginas, 4);
      for (const g of agruparClientes(resultado.registros)) {
        const clave = claveCliente(g.registros[0]);
        assert.ok(!vistos.has(clave), 'No se repite un comprador en otra página');
        vistos.add(clave); orden.push(clave);
        assert.equal(g.registros.length, registros.filter(r => !r.trabajo_hecho && !r.eliminado_en && claveCliente(r) === clave).length);
      }
      assert.ok(agruparClientes(resultado.registros).length <= 15);
    }
    assert.deepEqual(orden, esperados, 'Misma prioridad de pagos, fechas y desempates que la agenda original');
    for (const buscar of ['P-46-0', 'R-46-1', 'contacto-46', 'UNICO@EXAMPLE.INVALID']) {
      const resultado = await db.listarAgendaPanel({ buscar });
      assert.deepEqual(resultado.registros.map(r => r.ref).sort(), ['R-46-0', 'R-46-1', 'R-46-2']);
      assert.equal(resultado.personas, 1);
    }
    assert.equal((await db.listarAgendaPanel({ estado: 'agendado' })).personas, 30);
    const mixto = await db.listarAgendaPanel({ buscar: 'R-0-2', estado: 'agendado' });
    assert.equal(mixto.registros.length, 3, 'Filtro selecciona comprador sin recortar sus servicios');
    for (const buscar of ['no existe', '%', "_'; DROP TABLE clientes; --"]) {
      const vacio = await db.listarAgendaPanel({ buscar, pagina: 999 });
      assert.equal(vacio.pagina, 1); assert.equal(vacio.personas, 0); assert.deepEqual(vacio.registros, []);
    }
    assert.deepEqual(await db.resumenPanel(), resumen, 'Buscar no altera totales globales');
    // Si se vacía la última página, el refresco vuelve a la última válida.
    await db.pool.query(`UPDATE agendamientos SET data = data || '{"trabajo_hecho":true}'
      WHERE data->>'cliente_id' IN ('C-45','C-46') OR data->>'estado' = 'pendiente_pago' AND data->>'cliente_id' IS NULL`);
    const ajustada = await db.listarAgendaPanel({ pagina: 4 });
    assert.equal(ajustada.pagina, 3);
    assert.equal(ajustada.personas, 45);
    // 12.000 trabajos en 4.000 compradores, con campos pesados de evidencia.
    await db.pool.query('DELETE FROM agendamientos');
    await db.pool.query(`INSERT INTO agendamientos(ref,data)
      SELECT 'BENCH-' || n, jsonb_build_object('ref','BENCH-' || n,
        'cliente_id','BENCH-C-' || ((n-1)/3), 'estado','agendado',
        'creado_en','2026-01-01', 'producto','Servicio sintético',
        'evidencia_notas', repeat('e',2000))
      FROM generate_series(1,12000) n`);
    const inicio = performance.now();
    const grande = await db.listarAgendaPanel();
    const consultaMs = performance.now() - inicio;
    const inicioHtml = performance.now();
    const html = templates.adminDashboard({ registros: grande.registros, agenda: grande, resumen: await db.resumenPanel(), cargaPorPestana: true });
    const htmlMs = performance.now() - inicioHtml;
    assert.equal(grande.personas, 4000);
    assert.equal(grande.registros.length, 45);
    assert.ok(Buffer.byteLength(html) < 750000, 'HTML acotado a 15 compradores, no a toda la agenda');
    assert.ok(consultaMs < 5000, `Consulta demasiado lenta: ${consultaMs}ms`);
    assert.ok(htmlMs < 2000, `Render demasiado lento: ${htmlMs}ms`);
    assert.equal((await db.listarAgendaPanel({ buscar: 'BENCH-12000' })).registros.length, 3);
    t.diagnostic(`12.000 trabajos / 4.000 compradores: consulta ${consultaMs.toFixed(1)}ms; render+resumen ${htmlMs.toFixed(1)}ms; HTML ${Buffer.byteLength(html)} bytes; 45 trabajos enviados.`);
  } finally {
    if (db) await db.pool.end();
    if (started) ejecutar('pg_ctl', ['-D', pgdir, '-m', 'immediate', '-w', 'stop']);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
