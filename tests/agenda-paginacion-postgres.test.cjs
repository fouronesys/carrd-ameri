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
const { parseHTML } = require('linkedom');

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
          ...(n === 46 && j === 1 ? { adelanto: 'incluido' } : {}),
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
    let vistaRecorrido;
    for (let pagina = 1; pagina <= 4; pagina++) {
      const resultado = await db.listarAgendaPanel({ pagina, vista: vistaRecorrido });
      vistaRecorrido = resultado.vista;
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
    const urgentes = await db.listarAgendaPanel({ buscar: 'adelanto' });
    assert.deepEqual(urgentes.registros.map(r => r.ref).sort(), ['R-46-0', 'R-46-1', 'R-46-2'],
      'Buscar adelanto incluido devuelve todos los servicios del comprador');
    const htmlUrgentes = templates.adminDashboard({
      registros: urgentes.registros, agenda: urgentes, resumen,
      tipoPanel: 'trabajo', cargaPorPestana: true,
    });
    await t.test('Vista estable entre consultas con pagos, entregas, altas y cambios de prioridad', async () => {
      await db.pool.query('DELETE FROM agendamientos');
      const datos = Array.from({ length: 35 }, (_, i) => ({
        ref: `ESTABLE-${i}`, cliente_id: `CUENTA-${i}`, cliente_nombre: 'Mismo nombre',
        pedido_ref: `PEDIDO-${i}`, producto: 'Servicio estable', tipo_servicio: 'trabajo',
        estado: i === 34 ? 'pendiente_pago' : 'agendado',
        adelanto: i === 0 || i === 34 ? 'incluido' : undefined,
        pagado_en: `2026-01-${String(Math.min(i + 1, 28)).padStart(2, '0')}`,
      }));
      datos.push(
        { ...datos[0], ref: 'OTRO-SERVICIO', pedido_ref: 'OTRO-PEDIDO', adelanto: '' },
        { ...datos[0], ref: 'LECTURA-ESTABLE', tipo_servicio: 'lectura' },
        { ref: 'INV-A', pedido_ref: 'INV-A', cliente_nombre: 'Mismo nombre', estado: 'agendado' },
        { ref: 'INV-B', pedido_ref: 'INV-B', cliente_nombre: 'Mismo nombre', estado: 'agendado' },
        { ref: 'SIN-PEDIDO-A', cliente_nombre: 'Mismo nombre', estado: 'agendado' },
        { ref: 'SIN-PEDIDO-B', cliente_nombre: 'Mismo nombre', estado: 'agendado' },
      );
      await db.pool.query(`INSERT INTO agendamientos(ref,data)
        SELECT value->>'ref',value FROM jsonb_array_elements($1::jsonb)`, [JSON.stringify(datos)]);
      const opciones = { tipo: 'trabajo', sesion: 'sesion-sintetica-a' };
      const primera = await db.listarAgendaPanel(opciones);
      const comprobar = extra => db.listarAgendaPanel({ ...opciones, vista: primera.vista, comprobar: true, ...extra });
      assert.deepEqual(await comprobar(), { cambios: false, caducada: false });
      await db.actualizarPorRef('ESTABLE-0', { evidencia_notas: 'Edición sin efecto en el recorrido' });
      assert.equal((await comprobar()).cambios, false, 'Editar notas no genera avisos de prioridad');
      await db.actualizarPorRef('LECTURA-ESTABLE', { estado: 'rechazado' });
      assert.equal((await comprobar()).cambios, false, 'Una lectura no cambia el aviso de trabajos');
      await db.actualizarPorRef('LECTURA-ESTABLE', { estado: 'agendado' });
      const antigua = await db.listarAgendaPanel(opciones);
      await db.pool.query('UPDATE agenda_vistas SET filtros = $2 WHERE id = $1',
        [antigua.vista, JSON.stringify(['', 'todos', 'trabajo'])]);
      const compatible = await db.listarAgendaPanel({ ...opciones, vista: antigua.vista });
      assert.equal(compatible.vista, antigua.vista, 'Una vista anterior sin firma conserva su recorrido');
      assert.equal(compatible.cambios, true, 'La vista antigua ofrece actualizar voluntariamente');
      const vistasAntes = (await db.pool.query('SELECT count(*)::int AS n FROM agenda_vistas')).rows[0].n;
      for (const extra of [{ sesion: 'otro-admin' }, { buscar: 'otro filtro' }, { vista: 'invalida' }]) {
        assert.deepEqual(await comprobar(extra), { cambios: true, caducada: true });
      }
      assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM agenda_vistas')).rows[0].n, vistasAntes,
        'Comprobar es de solo lectura: nunca crea ni renueva vistas');
      const base = [];
      for (let pagina = 1; pagina <= primera.paginas; pagina++) {
        const resultado = await db.listarAgendaPanel({ ...opciones, vista: primera.vista, pagina });
        base.push(...agruparClientes(resultado.registros).map(g => claveCliente(g.registros[0])));
      }
      assert.equal(new Set(base).size, 39, 'Cuentas, invitados y servicios sin pedido conservan identidad');
      assert.equal(base[0], 'cliente:CUENTA-0');
      await db.actualizarPorRef('ESTABLE-34', { estado: 'agendado', pagado_en: '2026-02-01' });
      assert.deepEqual(await comprobar(), { cambios: true, caducada: false },
        'Detecta un urgente confirmado por otro administrador aunque esté fuera de página');
      await db.marcarTrabajoRealizado('ESTABLE-0'); // Pierde urgencia, pero conserva otro servicio activo.
      const desaparece = base[1];
      await db.pool.query(`UPDATE agendamientos SET data = data || '{"trabajo_hecho":true}'
        WHERE data->>'cliente_id' = $1 OR ('pedido:' || (data->>'pedido_ref')) = $2 OR ('servicio:' || ref) = $2`,
      [desaparece.replace('cliente:', ''), desaparece]);
      await db.pool.query(`INSERT INTO agendamientos(ref,data) VALUES
        ('NUEVO', '{"ref":"NUEVO","cliente_id":"NUEVO","adelanto":"incluido","estado":"agendado","tipo_servicio":"trabajo","pagado_en":"2025-01-01"}')`);
      const segunda = await db.listarAgendaPanel({ ...opciones, vista: primera.vista, pagina: 2 });
      assert.deepEqual(agruparClientes(segunda.registros).map(g => claveCliente(g.registros[0])), base.slice(15, 30),
        'Ni confirmar urgencia ni entregar otro comprador desplaza la segunda página');
      const recorrido = [];
      for (let pagina = 1; pagina <= primera.paginas; pagina++) {
        const resultado = await db.listarAgendaPanel({ ...opciones, vista: primera.vista, pagina });
        assert.equal(resultado.vista, primera.vista);
        assert.equal(resultado.personas, 39);
        assert.ok(!resultado.registros.some(r => r.ref === 'LECTURA-ESTABLE' || r.ref === 'NUEVO'));
        recorrido.push(...agruparClientes(resultado.registros).map(g => claveCliente(g.registros[0])));
      }
      assert.deepEqual(recorrido, base.filter(clave => clave !== desaparece),
        'Cada comprador que sigue activo aparece exactamente una vez en el recorrido');
      const repetida = await db.listarAgendaPanel({ ...opciones, vista: primera.vista });
      assert.ok(!repetida.registros.some(r => r.ref === 'ESTABLE-0'), 'Nunca resucita servicios entregados');
      assert.ok(repetida.registros.some(r => r.ref === 'OTRO-SERVICIO'), 'Conserva otros pedidos del comprador');
      const ultima = await db.listarAgendaPanel({ ...opciones, vista: primera.vista, pagina: 3 });
      assert.equal(ultima.registros.find(r => r.ref === 'ESTABLE-34').estado, 'agendado', 'El estado de pago es actual');
      const fresca = await db.listarAgendaPanel(opciones);
      assert.equal(fresca.cambios, false, 'Actualizar establece una nueva base sin aviso');
      assert.notEqual(fresca.vista, primera.vista);
      assert.equal(fresca.registros[0].ref, 'NUEVO', 'Actualizar recoge altas y recalcula prioridad');
      for (const cambio of [{ buscar: 'OTRO-PEDIDO' }, { estado: 'pendiente_pago' }, { tipo: 'lectura' }, { sesion: 'otra-sesion' }]) {
        const nueva = await db.listarAgendaPanel({ ...opciones, vista: primera.vista, pagina: 3, ...cambio });
        assert.notEqual(nueva.vista, primera.vista);
        assert.equal(nueva.pagina, 1);
        assert.equal(nueva.reiniciada, true);
        if (cambio.buscar) assert.deepEqual(nueva.registros.map(r => r.ref), ['OTRO-SERVICIO']);
        if (cambio.estado) assert.equal(nueva.personas, 0);
        if (cambio.tipo) assert.deepEqual(nueva.registros.map(r => r.ref), ['LECTURA-ESTABLE']);
      }
      for (const vista of ['------------------------------------', 'no-es-uuid']) {
        assert.equal((await db.listarAgendaPanel({ ...opciones, vista, pagina: 3 })).pagina, 1);
      }
      await db.pool.query(`UPDATE agenda_vistas SET vence_en = now() - interval '1 second' WHERE id = $1`, [primera.vista]);
      assert.deepEqual(await comprobar(), { cambios: true, caducada: true });
      assert.equal((await db.pool.query('SELECT 1 FROM agenda_vistas WHERE id = $1', [primera.vista])).rowCount, 1,
        'Comprobar no borra ni prolonga la vista caducada');
      const vencida = await db.listarAgendaPanel({ ...opciones, vista: primera.vista, pagina: 3 });
      assert.equal(vencida.pagina, 1);
      assert.equal(vencida.reiniciada, true);
      assert.equal((await db.pool.query('SELECT 1 FROM agenda_vistas WHERE id = $1', [primera.vista])).rowCount, 0);
      const d = parseHTML(templates.adminDashboard({ registros: vencida.registros, agenda: vencida })).document;
      assert.match(d.querySelector('[data-sec=agenda]').textContent, /vista anterior caducó/);
      assert.ok(new URL(d.querySelector('[aria-label="Páginas de la agenda"] a').href, 'http://fixture').searchParams.get('vista'));
    });
    // Recuperar la colección original para las comprobaciones siguientes.
    await db.pool.query('DELETE FROM agendamientos');
    await db.pool.query(`INSERT INTO agendamientos(ref,data)
      SELECT value->>'ref',value FROM jsonb_array_elements($1::jsonb)`, [JSON.stringify(registros)]);
    assert.doesNotMatch(htmlUrgentes, /⚡ Trabajos con adelanto incluido/,
      'Un adelanto rechazado no aparece como entrega prioritaria');
    assert.match(htmlUrgentes, /Incluye adelanto · sin pago confirmado/);
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
    await t.test('Adelanto pagado posterior a página 1 conserva comprador, tipos y prioridad al restaurar', async () => {
      await db.pool.query('DELETE FROM agendamientos');
      const datos = Array.from({ length: 17 }, (_, i) => ({
        ref: `NORMAL-${i}`, cliente_id: `NORMAL-C-${i}`, producto: 'Servicio normal',
        tipo_servicio: 'trabajo', estado: 'agendado', pagado_en: '2026-01-01',
      }));
      datos.push(
        { ref: 'URGENTE', cliente_id: 'MIXTO', pedido_ref: 'MIX-1', adelanto: 'incluido', estado: 'agendado', pagado_en: '2026-06-01' },
        { ref: 'OTRO-PEDIDO', cliente_id: 'MIXTO', pedido_ref: 'MIX-2', estado: 'agendado', pagado_en: '2026-06-02' },
        { ref: 'LECTURA', cliente_id: 'MIXTO', tipo_servicio: 'lectura', estado: 'agendado', pagado_en: '2026-06-02' },
        { ref: 'VERIFICAR', cliente_id: 'MIXTO', adelanto: 'incluido', estado: 'pendiente_verificacion' },
        { ref: 'RECHAZADO', cliente_id: 'NO-PAGO', adelanto: 'incluido', estado: 'rechazado' },
        { ref: 'PENDIENTE', cliente_id: 'NO-PAGO', adelanto: 'incluido', estado: 'pendiente_pago' },
        // Un adelanto suelto no identifica cuál servicio se debe adelantar.
        { ref: 'SUELTO', cliente_id: 'INDEPENDIENTE', pedido_ref: 'SUELTO-PED', adelanto: 'solo', estado: 'agendado', pagado_en: '2026-07-01' },
        { ref: 'SIN-ASOCIAR', cliente_id: 'INDEPENDIENTE', pedido_ref: 'SUELTO-PED', estado: 'agendado', pagado_en: '2026-07-01' },
        { ref: 'URGENTE-ANTERIOR', pedido_ref: 'INVITADO-URGENTE', adelanto: 'incluido', estado: 'agendado', pagado_en: '2026-05-01' },
        { ref: 'INVITADO-NORMAL', pedido_ref: 'INVITADO-URGENTE', estado: 'agendado', pagado_en: '2026-05-02' },
        { ref: 'URGENTE-HECHO', adelanto: 'incluido', estado: 'agendado', trabajo_hecho: true, pagado_en: '2025-01-01' },
        { ref: 'URGENTE-ELIMINADO', adelanto: 'incluido', estado: 'agendado', eliminado_en: '2026-01-01', pagado_en: '2025-01-01' },
      );
      await db.pool.query(`INSERT INTO agendamientos(ref,data)
        SELECT value->>'ref',value FROM jsonb_array_elements($1::jsonb)`, [JSON.stringify(datos)]);
      const primera = await db.listarAgendaPanel();
      assert.equal(primera.personas, 21);
      assert.equal(primera.trabajos, 27);
      assert.equal(primera.paginas, 2);
      const grupos = agruparClientes(primera.registros);
      assert.equal(claveCliente(grupos[0].registros[0]), 'pedido:INVITADO-URGENTE');
      assert.equal(claveCliente(grupos[1].registros[0]), 'cliente:MIXTO');
      assert.equal(grupos.length, 15);
      assert.deepEqual(grupos[1].registros.map(r => r.ref).sort(), ['LECTURA', 'OTRO-PEDIDO', 'URGENTE', 'VERIFICAR']);
      const segunda = await db.listarAgendaPanel({ pagina: 2 });
      const claves = [...primera.registros, ...segunda.registros].map(claveCliente);
      assert.equal(new Set(claves).size, 21);
      assert.equal(new Set([...primera.registros, ...segunda.registros].map(r => r.ref)).size, 27);
      assert.ok(!segunda.registros.some(r => ['MIXTO'].includes(r.cliente_id)));
      assert.ok(segunda.registros.some(r => r.ref === 'SUELTO'), 'Adelanto independiente no adelanta otros servicios');
      for (const buscar of ['adelanto', 'adelantos', 'urgencia', 'urgente']) {
        const resultado = await db.listarAgendaPanel({ buscar });
        assert.equal(resultado.personas, 4);
        assert.equal(resultado.trabajos, 10);
        const d = parseHTML(templates.adminDashboard({ registros: resultado.registros, agenda: resultado })).document;
        const prioritarios = [];
        let zona = '';
        for (const fila of d.querySelectorAll('#cuerpo-tabla tr')) {
          if (fila.classList.contains('agenda-zone')) zona = fila.textContent;
          if (fila.dataset.ref && zona.includes('entrega prioritaria')) prioritarios.push(fila.dataset.ref);
        }
        assert.deepEqual(prioritarios, ['URGENTE-ANTERIOR', 'URGENTE']);
        assert.match(d.querySelector('#cuerpo-tabla').textContent, /Adelantos independientes · sin servicio asociado/);
        assert.match(d.querySelector('[data-ref=VERIFICAR]').textContent, /sin pago confirmado/);
        assert.match(d.querySelector('[data-ref=RECHAZADO]').textContent, /sin pago confirmado/);
        assert.match(d.querySelector('[data-ref=PENDIENTE]').textContent, /sin pago confirmado/);
        assert.equal(d.querySelectorAll('#cuerpo-tabla tr[data-ref]').length, 10);
      }
      const trabajos = await db.listarAgendaPanel({ buscar: 'urgencia', tipo: 'trabajo' });
      assert.ok(!trabajos.registros.some(r => r.ref === 'LECTURA'));
      assert.equal(trabajos.registros.length, 9);
      const lecturas = await db.listarAgendaPanel({ tipo: 'lectura' });
      assert.deepEqual(lecturas.registros.map(r => r.ref), ['LECTURA']);
      assert.equal((await db.listarAgendaPanel({ buscar: 'urgencia', tipo: 'lectura' })).personas, 0);
      for (const estado of ['rechazado', 'pendiente_pago', 'pendiente_verificacion']) {
        const filtrada = await db.listarAgendaPanel({ buscar: 'urgencia', estado });
        assert.equal(filtrada.personas, 1);
        assert.equal(filtrada.registros.length, estado === 'pendiente_verificacion' ? 4 : 2);
      }
      await db.marcarTrabajoRealizado('URGENTE');
      const entregada = await db.listarAgendaPanel();
      assert.ok(!entregada.registros.some(r => r.cliente_id === 'MIXTO'),
        'Sin urgencia pagada activa, el comprador vuelve a su prioridad normal');
      assert.equal((await db.listarAgendaPanel({ buscar: 'MIX-2' })).registros.length, 3);
      await db.actualizarPorRef('URGENTE', { trabajo_hecho: false, trabajo_hecho_en: '' });
      assert.equal(agruparClientes((await db.listarAgendaPanel()).registros)[1].registros[0].ref, 'URGENTE');
      await db.eliminarPorRef('URGENTE');
      assert.ok(!(await db.listarAgendaPanel()).registros.some(r => r.ref === 'URGENTE'));
      await db.restaurarPorRef('URGENTE');
      assert.ok((await db.listarAgendaPanel()).registros.some(r => r.ref === 'URGENTE'));
    });
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
