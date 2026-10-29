'use strict';

// Capa de datos respaldada por PostgreSQL.
//
// Para garantizar CERO pérdida de datos en la migración desde los archivos JSON,
// cada registro se guarda tal cual en una columna `data` de tipo JSONB (el objeto
// completo, sin desglosar campo por campo). Así los objetos devueltos son
// idénticos a los que producía la versión basada en archivos. Las consultas y los
// ordenamientos se hacen con expresiones sobre el JSONB (data->>'campo').
//
// Los archivos JSON se conservan como respaldo: la migración es idempotente y solo
// importa una tabla si está vacía (para no resucitar registros borrados a mano).

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const historialCatalogo = require('./catalogo-historial');
const { CLAVE_CLIENTE_SQL } = require('./agenda-clientes');

const DATA_DIR = (function resolverDirectorioDatos() {
  const configurado = process.env.DATA_DIR;
  if (!configurado) return path.join(__dirname, '..', 'data');
  try {
    // CapRover monta normalmente /data como volumen persistente. En Replit,
    // ese punto de montaje puede no existir; no debemos hacer que el servidor
    // deje de arrancar solo por conservar el mismo secret entre entornos.
    fs.mkdirSync(configurado, { recursive: true });
    return configurado;
  } catch (e) {
    if (configurado === '/data' && (e.code === 'ENOENT' || e.code === 'EACCES')) {
      console.warn('[db] DATA_DIR=/data no está disponible; usando data/ local para este entorno.');
      return path.join(__dirname, '..', 'data');
    }
    throw e;
  }
})();
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
// Archivos JSON heredados (se conservan como respaldo y origen de la migración).
const DB_FILE = path.join(DATA_DIR, 'agendamientos.json');
const PROMOS_FILE = path.join(DATA_DIR, 'promociones.json');
const CLIENTES_FILE = path.join(DATA_DIR, 'clientes.json');
const USUARIOS_FILE = path.join(DATA_DIR, 'usuarios_admin.json');

function asegurarDirectorios() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

/* ---------- Pool de conexiones ---------- */
// Se prioriza POSTGRES_URL (p. ej. la cadena de Neon), y si no existe se usa la
// DATABASE_URL gestionada por Replit. Así puedes apuntar a un Postgres externo
// sin tocar la variable reservada de la plataforma.
const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL || '';
// SSL: se activa si la cadena lo pide (sslmode=require) o vía PGSSL=true. Los
// certificados de proveedores gestionados suelen ser autofirmados en la cadena.
const usarSSL = /sslmode=require/i.test(connectionString) ||
  String(process.env.PGSSL || '').toLowerCase() === 'true';

const pool = new Pool({
  connectionString: connectionString || undefined,
  ssl: usarSSL ? { rejectUnauthorized: false } : undefined,
  max: parseInt(process.env.PG_POOL_MAX || '10', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Diagnóstico de arranque: registra a QUÉ host se va a conectar (sin usuario ni
// contraseña) y de qué variable salió la cadena. Ayuda a detectar despliegues
// mal configurados (p. ej. host 'postgresql' interno de CapRover en vez de Neon).
(function registrarDestino() {
  const fuente = process.env.POSTGRES_URL
    ? 'POSTGRES_URL'
    : (process.env.DATABASE_URL ? 'DATABASE_URL' : (process.env.PGHOST ? 'PGHOST' : '(ninguna)'));
  let host = '(desconocido)';
  if (connectionString) {
    try { host = new URL(connectionString).hostname || host; } catch (_) { /* cadena no-URL */ }
  } else if (process.env.PGHOST) {
    host = process.env.PGHOST;
  }
  console.log('[db] Conectando a Postgres host=%s (fuente=%s, ssl=%s)', host, fuente, usarSSL);
})();

// Un error del pool no debe tumbar el proceso; se registra y se sigue.
pool.on('error', function (err) {
  console.error('[db] Error inesperado en el pool de PostgreSQL:', err.message);
});

async function q(texto, params) {
  return pool.query(texto, params);
}

// Serializa a JSON para pasarlo como parámetro jsonb sin ambigüedades.
function j(obj) {
  return JSON.stringify(obj || {});
}

/* ---------- Creación del esquema ---------- */
// Clave arbitraria (constante) para el lock de asesoría que serializa la
// creación del esquema entre instancias que arrancan a la vez.
const ESQUEMA_LOCK_KEY = 427100119;

async function crearEsquema() {
  // `CREATE TABLE IF NOT EXISTS` NO es seguro ante creadores concurrentes: dos
  // instancias que arrancan a la vez (despliegue rolling) pueden chocar en la
  // secuencia interna de un BIGSERIAL y fallar con "duplicate key ... pg_class".
  // Por eso toda la creación va dentro de UNA transacción protegida por un lock
  // de asesoría a nivel de transacción: la primera instancia crea el esquema y
  // las demás esperan y luego encuentran todo ya creado (IF NOT EXISTS salta).
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [ESQUEMA_LOCK_KEY]);

    await client.query(`CREATE TABLE IF NOT EXISTS agendamientos (
      ref  TEXT PRIMARY KEY,
      seq  BIGSERIAL,
      data JSONB NOT NULL
    )`);
    await client.query(`CREATE INDEX IF NOT EXISTS agendamientos_pedido_idx ON agendamientos ((data->>'pedido_ref'))`);
    await client.query(`CREATE INDEX IF NOT EXISTS agendamientos_creado_idx ON agendamientos ((data->>'creado_en'))`);
    await client.query(`CREATE INDEX IF NOT EXISTS agendamientos_codigo_idx ON agendamientos ((lower(data->>'codigo_promo')))`);
    await client.query(`CREATE TABLE IF NOT EXISTS avisos_realizado (
      ref TEXT PRIMARY KEY REFERENCES agendamientos(ref) ON DELETE CASCADE,
      estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','enviado','cancelado')),
      intentos INTEGER NOT NULL DEFAULT 0,
      proximo_intento TIMESTAMPTZ NOT NULL DEFAULT now(),
      creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
      enviado_en TIMESTAMPTZ,
      ultimo_error TEXT
    )`);
    await client.query(`CREATE INDEX IF NOT EXISTS avisos_realizado_pendientes_idx
      ON avisos_realizado (proximo_intento) WHERE estado = 'pendiente'`);

    await client.query(`CREATE TABLE IF NOT EXISTS promos (
      id   TEXT PRIMARY KEY,
      seq  BIGSERIAL,
      data JSONB NOT NULL
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS codigos (
      id   TEXT PRIMARY KEY,
      seq  BIGSERIAL,
      data JSONB NOT NULL
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS clientes (
      id    TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      data  JSONB NOT NULL
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS usuarios_admin (
      id      TEXT PRIMARY KEY,
      usuario TEXT UNIQUE,
      data    JSONB NOT NULL
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS destinatarios_notificaciones (
      id    TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      data  JSONB NOT NULL
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS accesos (
      seq  BIGSERIAL PRIMARY KEY,
      data JSONB NOT NULL
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS catalogo (
      id   TEXT PRIMARY KEY,
      seq  BIGSERIAL,
      data JSONB NOT NULL
    )`);
    await client.query(`CREATE INDEX IF NOT EXISTS catalogo_tipo_orden_idx
      ON catalogo ((data->>'tipo'), ((data->>'orden')::integer), seq)`);
    // Sin FK al catálogo: la auditoría debe sobrevivir a su eliminación.
    await client.query(`CREATE TABLE IF NOT EXISTS catalogo_historial (
      seq BIGSERIAL PRIMARY KEY,
      data JSONB NOT NULL
    )`);
    await client.query(`CREATE INDEX IF NOT EXISTS catalogo_historial_fecha_idx
      ON catalogo_historial ((data->>'fecha') DESC, seq DESC)`);
    // Índice único por id del evento: hace idempotente la importación de accesos
    // (evita duplicar filas al reejecutar la migración forzada).
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS accesos_id_idx ON accesos ((data->>'id'))`);

    // Tabla de metadatos: marca qué tablas ya completaron su migración desde JSON.
    // Permite reanudar una migración interrumpida sin resucitar datos borrados.
    await client.query(`CREATE TABLE IF NOT EXISTS meta (
      clave TEXT PRIMARY KEY,
      valor TEXT NOT NULL
    )`);

    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

// Marcadores de migración: una tabla se importa mientras no esté marcada como
// completada. Así, si una primera migración se corta a la mitad, al reiniciar se
// vuelve a intentar (con ON CONFLICT DO NOTHING, sin duplicar); y una vez
// completada nunca se reimporta, de modo que borrar un registro no lo resucita.
async function migracionHecha(clave) {
  const r = await q('SELECT 1 FROM meta WHERE clave = $1', ['migracion_' + clave]);
  return r.rowCount > 0;
}
async function marcarMigracion(clave) {
  await q(
    "INSERT INTO meta (clave, valor) VALUES ($1, 'done') ON CONFLICT (clave) DO NOTHING",
    ['migracion_' + clave]
  );
}

/* ---------- Migración idempotente desde JSON ---------- */
function leerJSON(archivo, porDefecto) {
  try {
    return JSON.parse(fs.readFileSync(archivo, 'utf8'));
  } catch (e) {
    return porDefecto;
  }
}

// Lectura ESTRICTA para la migración. Distingue tres casos, en vez de tragarse
// cualquier error como el JSON lenient de arriba:
//   - el archivo no existe        -> { existe:false, datos:porDefecto }  (instalación nueva legítima)
//   - el archivo existe y parsea  -> { existe:true,  datos:... }
//   - el archivo existe pero está ilegible/corrupto -> LANZA excepción
// Así una migración con un volumen sin montar o un JSON corrupto FALLA en vez de
// marcar la tabla como migrada con cero registros (pérdida de datos silenciosa).
function leerJSONMigracion(archivo, porDefecto) {
  if (!fs.existsSync(archivo)) return { existe: false, datos: porDefecto };
  let texto;
  try {
    texto = fs.readFileSync(archivo, 'utf8');
  } catch (e) {
    throw new Error('No se pudo leer el archivo de origen ' + archivo + ': ' + e.message);
  }
  try {
    return { existe: true, datos: JSON.parse(texto) };
  } catch (e) {
    throw new Error('El archivo de origen ' + archivo + ' está corrupto (JSON inválido); se aborta la migración para no perder datos: ' + e.message);
  }
}

async function contar(tabla) {
  const r = await q('SELECT count(*)::int AS n FROM ' + tabla);
  return r.rows[0].n;
}

// Importa los datos de los archivos JSON de forma idempotente.
//
// - soloSiVacio=true (arranque normal): importa una tabla solo si aún no está
//   marcada como migrada. Todas las inserciones usan ON CONFLICT DO NOTHING, así
//   que una migración interrumpida se reanuda sin duplicar; y una vez marcada,
//   nunca se reimporta (borrar un registro no lo resucita).
// - soloSiVacio=false (script manual): fuerza el reintento en todas las tablas.
//   Sigue siendo idempotente gracias a ON CONFLICT DO NOTHING.
async function migrarDesdeJSON(opciones) {
  const soloSiVacio = !opciones || opciones.soloSiVacio !== false;
  const resumen = {};
  // Devuelve true si toca importar esta tabla ahora.
  async function toca(clave) {
    if (!soloSiVacio) return true;
    return !(await migracionHecha(clave));
  }

  // Lectura ESTRICTA y PEREZOSA de los archivos de origen: cada archivo se lee
  // (y valida) una sola vez, y SOLO cuando alguna de las tablas que alimenta
  // necesita migrarse. Así, en estado ya migrado, un JSON de respaldo corrupto
  // NO tumba el arranque; solo se valida lo que de verdad se va a importar.
  const cacheFuente = {};
  function fuente(archivo, porDefecto) {
    if (!(archivo in cacheFuente)) cacheFuente[archivo] = leerJSONMigracion(archivo, porDefecto);
    return cacheFuente[archivo];
  }
  // Marca la tabla como migrada SOLO si su archivo de origen existía. Si el
  // archivo falta (p. ej. volumen sin montar), no se marca y se reintentará en
  // el próximo arranque, para que un montaje tardío no deje datos sin migrar.
  async function finalizar(clave, existe) {
    if (existe) await marcarMigracion(clave);
  }

  // Agendamientos
  if (await toca('agendamientos')) {
    const f = fuente(DB_FILE, { agendamientos: [] });
    const lista = Array.isArray(f.datos.agendamientos) ? f.datos.agendamientos : [];
    let n = 0;
    for (const reg of lista) {
      if (!reg || !reg.ref) continue;
      const r = await q(
        'INSERT INTO agendamientos (ref, data) VALUES ($1, $2::jsonb) ON CONFLICT (ref) DO NOTHING',
        [reg.ref, j(reg)]
      );
      n += r.rowCount;
    }
    await finalizar('agendamientos', f.existe);
    resumen.agendamientos = n;
  }

  // Promos y códigos
  if (await toca('promos')) {
    const f = fuente(PROMOS_FILE, { promos: [], codigos: [] });
    const lista = Array.isArray(f.datos.promos) ? f.datos.promos : [];
    let n = 0;
    for (const p of lista) {
      if (!p || !p.id) continue;
      const r = await q('INSERT INTO promos (id, data) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO NOTHING', [p.id, j(p)]);
      n += r.rowCount;
    }
    await finalizar('promos', f.existe);
    resumen.promos = n;
  }
  if (await toca('codigos')) {
    const f = fuente(PROMOS_FILE, { promos: [], codigos: [] });
    const lista = Array.isArray(f.datos.codigos) ? f.datos.codigos : [];
    let n = 0;
    for (const c of lista) {
      if (!c || !c.id) continue;
      const r = await q('INSERT INTO codigos (id, data) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO NOTHING', [c.id, j(c)]);
      n += r.rowCount;
    }
    await finalizar('codigos', f.existe);
    resumen.codigos = n;
  }

  // Clientes
  if (await toca('clientes')) {
    const f = fuente(CLIENTES_FILE, { clientes: [] });
    const lista = Array.isArray(f.datos.clientes) ? f.datos.clientes : [];
    let n = 0;
    for (const c of lista) {
      if (!c || !c.id) continue;
      const r = await q(
        'INSERT INTO clientes (id, email, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT (id) DO NOTHING',
        [c.id, normalizarEmail(c.email), j(c)]
      );
      n += r.rowCount;
    }
    await finalizar('clientes', f.existe);
    resumen.clientes = n;
  }

  // Usuarios del panel
  if (await toca('usuarios_admin')) {
    const f = fuente(USUARIOS_FILE, { usuarios: [], accesos: [] });
    const lista = Array.isArray(f.datos.usuarios) ? f.datos.usuarios : [];
    let n = 0;
    for (const u of lista) {
      if (!u || !u.id) continue;
      const r = await q(
        'INSERT INTO usuarios_admin (id, usuario, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT (id) DO NOTHING',
        [u.id, normalizarUsuario(u.usuario), j(u)]
      );
      n += r.rowCount;
    }
    await finalizar('usuarios_admin', f.existe);
    resumen.usuarios = n;
  }
  // Accesos: en el JSON el más reciente va primero; se insertan en orden inverso
  // para que el `seq` mayor corresponda al acceso más reciente. El ON CONFLICT
  // sobre el id del evento evita duplicar filas al reejecutar la migración.
  if (await toca('accesos')) {
    const f = fuente(USUARIOS_FILE, { usuarios: [], accesos: [] });
    const original = Array.isArray(f.datos.accesos) ? f.datos.accesos : [];
    // Se recorre de atrás hacia adelante (el más antiguo primero) conservando el
    // índice original, que sirve para sintetizar un id estable a los eventos
    // antiguos que no lo tengan, sin perder ninguna fila ni duplicar al reejecutar.
    let n = 0;
    for (let i = original.length - 1; i >= 0; i--) {
      const a = original[i];
      if (!a) continue;
      const evento = a.id ? a : Object.assign({}, a, { id: 'legacy-' + i });
      const r = await q(
        "INSERT INTO accesos (data) VALUES ($1::jsonb) ON CONFLICT ((data->>'id')) DO NOTHING",
        [j(evento)]
      );
      n += r.rowCount;
    }
    await finalizar('accesos', f.existe);
    resumen.accesos = n;
  }

  return resumen;
}

// Verifica que TODOS los registros presentes en los archivos JSON estén también
// en PostgreSQL. Para cada entidad cuenta los registros válidos de origen (los
// que la migración importaría) y las filas en destino. Como el destino puede
// crecer con tráfico en vivo, la garantía de "sin pérdida" es destino >= origen;
// solo falla (ok=false) si el destino tiene MENOS filas que el origen.
async function verificarMigracion(tablas) {
  const ag = leerJSON(DB_FILE, { agendamientos: [] });
  const promoData = leerJSON(PROMOS_FILE, { promos: [], codigos: [] });
  const cl = leerJSON(CLIENTES_FILE, { clientes: [] });
  const usu = leerJSON(USUARIOS_FILE, { usuarios: [], accesos: [] });

  function validos(lista, tieneClave) {
    if (!Array.isArray(lista)) return 0;
    return lista.filter(tieneClave).length;
  }

  const fuentes = {
    agendamientos: validos(ag.agendamientos, function (x) { return x && x.ref; }),
    promos: validos(promoData.promos, function (x) { return x && x.id; }),
    codigos: validos(promoData.codigos, function (x) { return x && x.id; }),
    clientes: validos(cl.clientes, function (x) { return x && x.id; }),
    usuarios_admin: validos(usu.usuarios, function (x) { return x && x.id; }),
    // Todos los accesos no nulos se preservan (se les sintetiza un id si falta).
    accesos: validos(usu.accesos, function (x) { return !!x; }),
  };

  // Si se pasa una lista de tablas, se verifican solo esas; si no, todas.
  const claves = (Array.isArray(tablas) && tablas.length)
    ? Object.keys(fuentes).filter(function (t) { return tablas.indexOf(t) >= 0; })
    : Object.keys(fuentes);

  const detalle = {};
  let ok = true;
  for (const tabla of claves) {
    const origen = fuentes[tabla];
    const destino = await contar(tabla);
    const tablaOk = destino >= origen;
    if (!tablaOk) ok = false;
    detalle[tabla] = { origen: origen, destino: destino, ok: tablaOk };
  }
  return { ok: ok, detalle: detalle };
}

let inicializado = false;
async function init() {
  if (inicializado) return;
  asegurarDirectorios();
  await crearEsquema();
  // Migración automática durante el despliegue: al arrancar el contenedor se
  // importan (una sola vez, marcador en `meta`) las tablas aún no migradas. No
  // hace falta ejecutar ningún script manual.
  const resumen = await migrarDesdeJSON({ soloSiVacio: true });

  // Nombres de tabla correspondientes a las claves del resumen.
  const mapaTablas = {
    agendamientos: 'agendamientos',
    promos: 'promos',
    codigos: 'codigos',
    clientes: 'clientes',
    usuarios: 'usuarios_admin',
    accesos: 'accesos',
  };
  const tablasMigradas = Object.keys(resumen)
    .map(function (k) { return mapaTablas[k]; })
    .filter(Boolean);

  const importados = Object.keys(resumen).filter(function (k) { return resumen[k] > 0; });
  if (importados.length) {
    console.log('[db] Migración desde JSON:', JSON.stringify(resumen));
  }

  // Verifica la integridad SOLO de las tablas recién migradas en este arranque.
  // No se verifican tablas ya migradas en despliegues anteriores, porque un
  // borrado legítimo en producción (el JSON de respaldo conserva el original)
  // haría destino < origen y bloquearía futuros despliegues por una falsa alarma.
  if (tablasMigradas.length) {
    const verificacion = await verificarMigracion(tablasMigradas);
    for (const tabla of Object.keys(verificacion.detalle)) {
      const d = verificacion.detalle[tabla];
      console.log('[db] Verificación migración ' + tabla + ': origen=' + d.origen + ' destino=' + d.destino + (d.ok ? ' OK' : ' FALLA'));
    }
    if (!verificacion.ok) {
      // Aborta el arranque: la instancia nueva no llegará a "healthy" y el
      // rolling update no retirará la anterior, evitando servir con datos perdidos.
      throw new Error('Migración incompleta durante el despliegue: alguna tabla quedó con menos registros que el JSON de origen.');
    }
  }

  inicializado = true;
}

async function verificarConexion() {
  await q('SELECT 1');
  return true;
}

async function cerrar() {
  await pool.end();
}

/* ---------- Agendamientos ---------- */
async function crearAgendamiento(registro) {
  const r = await q(
    'INSERT INTO agendamientos (ref, data) VALUES ($1, $2::jsonb) ON CONFLICT (ref) DO UPDATE SET data = EXCLUDED.data RETURNING data',
    [registro.ref, j(registro)]
  );
  return r.rows[0].data;
}

async function obtenerPorRef(ref) {
  const r = await q('SELECT data FROM agendamientos WHERE ref = $1', [ref]);
  return r.rows[0] ? r.rows[0].data : null;
}

async function actualizarPorRef(ref, cambios) {
  const r = await q(
    'UPDATE agendamientos SET data = data || $2::jsonb WHERE ref = $1 RETURNING data',
    [ref, j(cambios)]
  );
  return r.rows[0] ? r.rows[0].data : null;
}

// Una sola transición gana, incluso si webhook, retorno y conciliador corren
// simultáneamente en distintas instancias. Un rechazo tardío no revierte un pago.
async function actualizarEstadoWompi(referencia, cambios, esPedido) {
  if (!['agendado', 'rechazado'].includes(cambios.estado)) throw new Error('Estado Wompi inválido');
  const filtro = esPedido ? "data->>'pedido_ref' = $1" : 'ref = $1';
  const r = await q(
    'UPDATE agendamientos SET data = data || $2::jsonb WHERE ' + filtro +
    " AND data->>'metodo' = 'wompi' AND data->>'estado' IN ('pendiente_pago','rechazado')" +
    " AND data->>'estado' <> $3 RETURNING data",
    [referencia, j(cambios), cambios.estado]
  );
  return r.rows.map(x => x.data);
}

// La entrega y su outbox se confirman juntas: nunca queda un trabajo marcado
// sin su aviso pendiente aunque el proceso muera antes de responder al HTTP.
async function marcarTrabajoRealizado(ref) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(`UPDATE agendamientos SET data = data ||
      CASE WHEN data->>'trabajo_hecho' = 'true' THEN '{}'::jsonb
      ELSE jsonb_build_object('trabajo_hecho', true, 'trabajo_hecho_en', clock_timestamp()) END
      WHERE ref = $1 AND data->>'estado' = 'agendado' AND data->>'eliminado_en' IS NULL
      RETURNING data`, [ref]);
    const reg = r.rows[0]?.data;
    if (reg && reg.cliente_id && !reg.cliente_aviso_realizado && !reg.aviso_realizado_enviado) {
      // No tocar una fila existente: el consumidor puede tenerla bloqueada
      // mientras espera SMTP. Evita que el HTTP espere ese envío.
      await client.query(`INSERT INTO avisos_realizado (ref)
        SELECT $1 WHERE NOT EXISTS (SELECT 1 FROM avisos_realizado WHERE ref = $1)
        ON CONFLICT (ref) DO NOTHING`, [ref]);
    }
    await client.query('COMMIT');
    return reg || null;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally { client.release(); }
}

// Mantener el bloqueo hasta la confirmación SMTP impide que otra instancia
// reclame el mismo aviso, sin depender de relojes, leases o timers en memoria.
// Al morir la conexión PostgreSQL revierte y libera el trabajo automáticamente.
async function procesarSiguienteAvisoRealizado(enviar) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(`SELECT ref, intentos FROM avisos_realizado
      WHERE estado = 'pendiente' AND proximo_intento <= now()
      ORDER BY proximo_intento, ref FOR UPDATE SKIP LOCKED LIMIT 1`);
    const aviso = r.rows[0];
    if (!aviso) { await client.query('COMMIT'); return false; }
    const registro = await client.query('SELECT data FROM agendamientos WHERE ref = $1', [aviso.ref]);
    const reg = registro.rows[0]?.data;
    if (!reg || reg.eliminado_en || reg.cliente_aviso_realizado || reg.aviso_realizado_enviado || !reg.cliente_id) {
      await client.query("UPDATE avisos_realizado SET estado = 'cancelado' WHERE ref = $1", [aviso.ref]);
    } else if (!reg.trabajo_hecho || reg.estado !== 'agendado') {
      await client.query("UPDATE avisos_realizado SET proximo_intento = now() + interval '1 minute' WHERE ref = $1", [aviso.ref]);
    } else {
      const cliente = await client.query('SELECT data FROM clientes WHERE id = $1', [reg.cliente_id]);
      const to = cliente.rows[0]?.data.email;
      let resultado, fallo;
      // Solo capturar fallos SMTP aquí. Si falla la confirmación SQL después
      // del envío, revertir toda la transacción y dejar el aviso recuperable.
      try {
        if (!to) throw new Error('sin_correo');
        resultado = await enviar(reg, to, '<realizado.' + Buffer.from(aviso.ref).toString('hex') + '@fresatanika>');
        if (!resultado?.enviado) throw new Error(resultado?.motivo || 'envio_no_confirmado');
      } catch (e) { fallo = e; }
      if (fallo) {
        const segundos = Math.min(6 * 60 * 60, 30 * 2 ** Math.min(aviso.intentos, 10));
        await client.query(`UPDATE avisos_realizado SET intentos = intentos + 1,
          proximo_intento = now() + $2 * interval '1 second', ultimo_error = $3 WHERE ref = $1`,
        [aviso.ref, segundos, String(fallo.code || fallo.message || 'error_smtp').slice(0, 300)]);
        console.warn('[avisos] Envío no confirmado; reintento programado.');
      } else {
        await client.query(`UPDATE agendamientos SET data = data ||
          jsonb_build_object('cliente_aviso_realizado', clock_timestamp()) WHERE ref = $1`, [aviso.ref]);
        await client.query(`UPDATE avisos_realizado SET estado = 'enviado', enviado_en = now(),
          intentos = intentos + 1, ultimo_error = NULL WHERE ref = $1`, [aviso.ref]);
      }
    }
    await client.query('COMMIT');
    return true;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally { client.release(); }
}

async function listarAgendamientos() {
  const r = await q(
    "SELECT data FROM agendamientos " +
    "WHERE data->>'eliminado_en' IS NULL AND (data->>'trabajo_hecho' IS NULL OR data->>'trabajo_hecho' != 'true') " +
    "ORDER BY CASE data->>'estado' WHEN 'agendado' THEN 0 WHEN 'pendiente_verificacion' THEN 1 WHEN 'pendiente_pago' THEN 2 ELSE 3 END, " +
    "CASE WHEN data->>'estado' = 'agendado' THEN coalesce(nullif(data->>'pagado_en',''), data->>'creado_en') END ASC NULLS LAST, " +
    "seq DESC"
  );
  return r.rows.map(function (x) { return x.data; });
}

// One query instead of looking up each client's email serially.
async function listarAgendaPanel() {
  const r = await q(
    `SELECT a.data || jsonb_build_object('cliente_email', coalesce(c.data->>'email','')) AS data
     FROM agendamientos a LEFT JOIN clientes c ON c.id = a.data->>'cliente_id'
     WHERE a.data->>'eliminado_en' IS NULL AND coalesce(a.data->>'trabajo_hecho','false') != 'true'
     ORDER BY CASE a.data->>'estado' WHEN 'agendado' THEN 0 WHEN 'pendiente_verificacion' THEN 1 ELSE 2 END,
     CASE WHEN a.data->>'estado' = 'agendado' THEN coalesce(nullif(a.data->>'pagado_en',''),a.data->>'creado_en') END ASC NULLS LAST,
     a.seq DESC`
  );
  return r.rows.map(x => x.data);
}

async function resumenPanel() {
  const r = await q(`SELECT
    count(*) FILTER (WHERE data->>'eliminado_en' IS NULL AND coalesce(data->>'trabajo_hecho','false') != 'true')::int AS total,
    count(*) FILTER (WHERE data->>'eliminado_en' IS NULL AND coalesce(data->>'trabajo_hecho','false') != 'true' AND data->>'estado' = 'agendado')::int AS agendados,
    count(DISTINCT (${CLAVE_CLIENTE_SQL})) FILTER (WHERE data->>'eliminado_en' IS NULL AND coalesce(data->>'trabajo_hecho','false') != 'true' AND data->>'estado' = 'agendado')::int AS personas_agendadas,
    count(*) FILTER (WHERE data->>'eliminado_en' IS NULL AND coalesce(data->>'trabajo_hecho','false') != 'true' AND data->>'estado' = 'pendiente_verificacion')::int AS verificar,
    count(*) FILTER (WHERE data->>'eliminado_en' IS NULL AND data->>'trabajo_hecho' = 'true')::int AS realizados,
    coalesce(sum(CASE WHEN data->>'estado' = 'agendado' AND data->>'precio_cop' ~ '^[0-9]+$' THEN (data->>'precio_cop')::numeric ELSE 0 END),0) AS ingresos,
    (SELECT count(*)::int FROM catalogo) AS catalogo
    FROM agendamientos`);
  return r.rows[0];
}

async function listarCodigosConUsos() {
  const [codigos, usos] = await Promise.all([
    listarCodigos(),
    q("SELECT lower(trim(data->>'codigo_promo')) AS codigo, count(*)::int AS usos FROM agendamientos WHERE coalesce(data->>'estado','') <> 'rechazado' GROUP BY lower(trim(data->>'codigo_promo'))"),
  ]);
  const mapa = new Map(usos.rows.map(x => [x.codigo, x.usos]));
  return codigos.map(c => Object.assign({}, c, { usos: mapa.get(String(c.codigo || '').trim().toLowerCase()) || 0 }));
}

async function obtenerPorPedido(pedidoRef) {
  if (!pedidoRef) return [];
  const r = await q("SELECT data FROM agendamientos WHERE data->>'pedido_ref' = $1 ORDER BY seq ASC", [pedidoRef]);
  return r.rows.map(function (x) { return x.data; });
}

// Todos los agendamientos de un cliente registrado, del más reciente al más
// antiguo. Alimenta la sección "Mis consultas" de la cuenta.
async function listarPorCliente(clienteId) {
  if (!clienteId) return [];
  const r = await q(
    "SELECT data FROM agendamientos WHERE data->>'cliente_id' = $1 ORDER BY seq DESC",
    [clienteId]
  );
  return r.rows.map(function (x) { return x.data; });
}

async function actualizarPorPedido(pedidoRef, cambios) {
  const r = await q(
    "UPDATE agendamientos SET data = data || $2::jsonb WHERE data->>'pedido_ref' = $1 RETURNING data",
    [pedidoRef, j(cambios)]
  );
  return r.rows.map(function (x) { return x.data; });
}

function eliminarFoto(nombre) {
  if (!nombre) return;
  try { fs.unlinkSync(path.join(UPLOADS_DIR, nombre)); } catch (e) { /* noop */ }
}

function eliminarAdjuntos(registro) {
  if (!registro) return;
  eliminarFoto(registro.objetivo_foto);
  eliminarFoto(registro.comprobante);
  if (Array.isArray(registro.evidencia_fotos)) {
    registro.evidencia_fotos.forEach(function (n) { eliminarFoto(n); });
  }
}

async function eliminarPorRef(ref) {
  const r = await q('SELECT data FROM agendamientos WHERE ref = $1', [ref]);
  if (!r.rows[0]) return false;
  // Borrado lógico: marcar como eliminado en lugar de borrar físicamente
  await q(
    'UPDATE agendamientos SET data = data || $2::jsonb WHERE ref = $1',
    [ref, j({ eliminado_en: new Date().toISOString() })]
  );
  return true;
}

async function eliminarDefinitivamentePorRef(ref) {
  const r = await q('SELECT data FROM agendamientos WHERE ref = $1', [ref]);
  if (!r.rows[0]) return false;
  eliminarAdjuntos(r.rows[0].data);
  await q('DELETE FROM agendamientos WHERE ref = $1', [ref]);
  return true;
}

async function restaurarPorRef(ref) {
  const r = await q(
    'UPDATE agendamientos SET data = data || $2::jsonb WHERE ref = $1 RETURNING data',
    [ref, j({ eliminado_en: null })]
  );
  return r.rows[0] ? r.rows[0].data : null;
}

async function listarEliminados() {
  const r = await q("SELECT data FROM agendamientos WHERE data->>'eliminado_en' IS NOT NULL ORDER BY data->>'eliminado_en' DESC");
  return r.rows.map(function (x) { return x.data; });
}

async function listarRealizados() {
  const r = await q("SELECT data FROM agendamientos WHERE data->>'trabajo_hecho' = 'true' AND data->>'eliminado_en' IS NULL ORDER BY data->>'trabajo_hecho_en' DESC NULLS LAST");
  return r.rows.map(function (x) { return x.data; });
}

async function eliminarPendientesAntiguos(horas) {
  const limiteIso = new Date(Date.now() - horas * 60 * 60 * 1000).toISOString();
  const r = await q(
    "SELECT ref, data FROM agendamientos WHERE data->>'estado' = 'pendiente_pago' AND coalesce(data->>'creado_en', '') <> '' AND data->>'creado_en' < $1",
    [limiteIso]
  );
  if (!r.rows.length) return 0;
  for (const row of r.rows) eliminarAdjuntos(row.data);
  await q('DELETE FROM agendamientos WHERE ref = ANY($1)', [r.rows.map(function (x) { return x.ref; })]);
  return r.rows.length;
}

// Pagos con Wompi que quedaron en "pendiente_pago" (el cliente pagó pero nunca
// volvió a la página de gracias y/o el webhook no llegó). Se usan para
// reconciliar contra la API de Wompi por REFERENCIA (sin necesitar el id de
// transacción) antes de agendar o de borrar por antigüedad, para no perder
// pagos ya realizados.
async function listarPendientesPagoWompi() {
  const r = await q(
    "SELECT ref, data FROM agendamientos WHERE data->>'estado' = 'pendiente_pago' AND data->>'metodo' = 'wompi'"
  );
  return r.rows.map(function (x) { return x.data; });
}

/* ---------- Promociones (promos por fecha y códigos) ---------- */
async function listarPromos() {
  const r = await q('SELECT data FROM promos ORDER BY seq ASC');
  return r.rows.map(function (x) { return x.data; });
}

async function crearPromo(promo) {
  const r = await q(
    'INSERT INTO promos (id, data) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data RETURNING data',
    [promo.id, j(promo)]
  );
  return r.rows[0].data;
}

async function eliminarPromo(id) {
  const r = await q('DELETE FROM promos WHERE id = $1', [id]);
  return r.rowCount > 0;
}

async function listarCodigos() {
  const r = await q('SELECT data FROM codigos ORDER BY seq ASC');
  return r.rows.map(function (x) { return x.data; });
}

async function crearCodigo(codigo) {
  const r = await q(
    'INSERT INTO codigos (id, data) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data RETURNING data',
    [codigo.id, j(codigo)]
  );
  return r.rows[0].data;
}

async function eliminarCodigo(id) {
  const r = await q('DELETE FROM codigos WHERE id = $1', [id]);
  return r.rowCount > 0;
}

// Cuenta cuántas veces se ha usado un código promocional (agendamientos que lo
// llevan aplicado y que no fueron rechazados; así los cupos se liberan solos).
async function contarUsosCodigo(codigoStr) {
  const cod = String(codigoStr || '').trim().toLowerCase();
  if (!cod) return 0;
  const r = await q(
    "SELECT count(*)::int AS n FROM agendamientos WHERE lower(trim(data->>'codigo_promo')) = $1 AND coalesce(data->>'estado', '') <> 'rechazado'",
    [cod]
  );
  return r.rows[0].n;
}

/* ---------- Cuentas de cliente (correo + contraseña) ---------- */
function normalizarEmail(email) {
  return String(email || '').trim().toLowerCase();
}

async function obtenerClientePorEmail(email) {
  const e = normalizarEmail(email);
  if (!e) return null;
  const r = await q('SELECT data FROM clientes WHERE email = $1', [e]);
  return r.rows[0] ? r.rows[0].data : null;
}

async function obtenerClientePorId(id) {
  if (!id) return null;
  const r = await q('SELECT data FROM clientes WHERE id = $1', [id]);
  return r.rows[0] ? r.rows[0].data : null;
}

async function crearCliente(cliente) {
  const r = await q(
    'INSERT INTO clientes (id, email, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, data = EXCLUDED.data RETURNING data',
    [cliente.id, normalizarEmail(cliente.email), j(cliente)]
  );
  return r.rows[0].data;
}

async function actualizarClientePorId(id, cambios) {
  const r = await q(
    "UPDATE clientes SET data = data || $2::jsonb, email = coalesce(lower(($2::jsonb)->>'email'), email) WHERE id = $1 RETURNING data",
    [id, j(cambios)]
  );
  return r.rows[0] ? r.rows[0].data : null;
}

async function guardarCarritoCliente(id, carrito) {
  return actualizarClientePorId(id, { carrito: Array.isArray(carrito) ? carrito : [] });
}

/* ---------- Usuarios del panel + auditoría de accesos ---------- */
function normalizarUsuario(usuario) {
  return String(usuario || '').trim().toLowerCase();
}

async function listarUsuariosAdmin() {
  const r = await q("SELECT data FROM usuarios_admin ORDER BY data->>'usuario' ASC");
  return r.rows.map(function (x) { return x.data; });
}

async function obtenerUsuarioAdmin(usuario) {
  const u = normalizarUsuario(usuario);
  if (!u) return null;
  const r = await q('SELECT data FROM usuarios_admin WHERE usuario = $1', [u]);
  return r.rows[0] ? r.rows[0].data : null;
}

async function obtenerUsuarioAdminPorId(id) {
  if (!id) return null;
  const r = await q('SELECT data FROM usuarios_admin WHERE id = $1', [id]);
  return r.rows[0] ? r.rows[0].data : null;
}

async function crearUsuarioAdmin(usuario) {
  const r = await q(
    'INSERT INTO usuarios_admin (id, usuario, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT (id) DO UPDATE SET usuario = EXCLUDED.usuario, data = EXCLUDED.data RETURNING data',
    [usuario.id, normalizarUsuario(usuario.usuario), j(usuario)]
  );
  return r.rows[0].data;
}

async function actualizarUsuarioAdmin(id, cambios) {
  const r = await q(
    'UPDATE usuarios_admin SET data = data || $2::jsonb WHERE id = $1 RETURNING data',
    [id, j(cambios)]
  );
  return r.rows[0] ? r.rows[0].data : null;
}

async function eliminarUsuarioAdmin(id) {
  const r = await q('DELETE FROM usuarios_admin WHERE id = $1', [id]);
  return r.rowCount > 0;
}

async function listarDestinatariosNotificaciones() {
  const r = await q('SELECT data FROM destinatarios_notificaciones ORDER BY email');
  return r.rows.map(x => x.data);
}

async function obtenerDestinatarioNotificaciones(id) {
  const r = await q('SELECT data FROM destinatarios_notificaciones WHERE id = $1', [id]);
  return r.rows[0] ? r.rows[0].data : null;
}

async function guardarDestinatarioNotificaciones(destinatario) {
  const r = await q(
    `INSERT INTO destinatarios_notificaciones (id, email, data) VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, data = EXCLUDED.data RETURNING data`,
    [destinatario.id, normalizarEmail(destinatario.email), j(destinatario)]
  );
  return r.rows[0].data;
}

async function eliminarDestinatarioNotificaciones(id) {
  const r = await q('DELETE FROM destinatarios_notificaciones WHERE id = $1', [id]);
  return r.rowCount > 0;
}

// Guarda un evento de acceso y conserva como máximo los últimos 500.
async function registrarAcceso(evento) {
  await q(
    "INSERT INTO accesos (data) VALUES ($1::jsonb) ON CONFLICT ((data->>'id')) DO NOTHING",
    [j(evento)]
  );
  await q('DELETE FROM accesos WHERE seq NOT IN (SELECT seq FROM accesos ORDER BY seq DESC LIMIT 500)');
  return evento;
}

async function listarAccesos(limite) {
  if (limite) {
    const r = await q('SELECT data FROM accesos ORDER BY seq DESC LIMIT $1', [limite]);
    return r.rows.map(function (x) { return x.data; });
  }
  const r = await q('SELECT data FROM accesos ORDER BY seq DESC');
  return r.rows.map(function (x) { return x.data; });
}

/* ---------- Catálogo administrable ---------- */
async function listarCatalogo() {
  const r = await q(
    "SELECT data FROM catalogo ORDER BY CASE data->>'tipo' WHEN 'hechizo' THEN 0 ELSE 1 END, " +
    "coalesce((data->>'orden')::integer, 9999), seq ASC"
  );
  return r.rows.map(function (x) { return x.data; });
}

async function listarCatalogoActivo() {
  const r = await q(
    "SELECT data FROM catalogo WHERE coalesce(data->>'activo','true') = 'true' " +
    "ORDER BY CASE data->>'tipo' WHEN 'hechizo' THEN 0 ELSE 1 END, " +
    "coalesce((data->>'orden')::integer, 9999), seq ASC"
  );
  return r.rows.map(function (x) { return x.data; });
}

async function obtenerCatalogoPorId(id) {
  const r = await q('SELECT data FROM catalogo WHERE id = $1', [id]);
  return r.rows[0] ? r.rows[0].data : null;
}

async function mutarCatalogo(id, cambios, actor, operacion) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let anterior = null, nuevo = null, accion = operacion;
    if (operacion === 'creacion') {
      const r = await client.query('INSERT INTO catalogo (id, data) VALUES ($1, $2::jsonb) RETURNING data', [id, j(cambios)]);
      nuevo = r.rows[0].data;
    } else {
      const r = await client.query('SELECT data FROM catalogo WHERE id = $1 FOR UPDATE', [id]);
      anterior = r.rows[0] ? r.rows[0].data : null;
      if (!anterior) { await client.query('ROLLBACK'); return null; }
      if (operacion === 'eliminacion') {
        await client.query('DELETE FROM catalogo WHERE id = $1', [id]);
      } else {
        if (operacion === 'estado') {
          cambios = { activo: anterior.activo === false, actualizado_en: new Date().toISOString() };
          accion = cambios.activo ? 'activacion' : 'desactivacion';
        } else {
          // Una edición de precio/nombre no puede revertir un estado concurrente.
          cambios = { ...cambios };
          delete cambios.activo;
        }
        const actualizado = await client.query('UPDATE catalogo SET data = data || $2::jsonb WHERE id = $1 RETURNING data', [id, j(cambios)]);
        nuevo = actualizado.rows[0].data;
      }
    }
    const evento = historialCatalogo.evento(accion, anterior, nuevo, actor);
    await client.query('INSERT INTO catalogo_historial (data) VALUES ($1::jsonb)', [j(evento)]);
    await client.query('COMMIT');
    return nuevo || anterior;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function guardarCatalogoItem(item, actor) {
  return mutarCatalogo(item.id, item, actor, 'creacion');
}

async function actualizarCatalogoItem(id, cambios, actor, operacion) {
  return mutarCatalogo(id, cambios, actor, operacion === 'estado' ? 'estado' : 'edicion');
}

async function eliminarCatalogoItem(id, actor) {
  return mutarCatalogo(id, null, actor, 'eliminacion');
}

async function listarHistorialCatalogo(query) {
  const f = historialCatalogo.filtros(query);
  const params = [];
  const condiciones = [];
  function condicion(sql, valor) {
    params.push(valor);
    condiciones.push(sql.replace('?', '$' + params.length));
  }
  if (f.buscar) condicion(`strpos(lower(concat_ws(' ', data->>'catalogo_id', data->>'usuario',
    data->>'usuario_id', data->'anterior'->>'nombre', data->'nuevo'->>'nombre')), lower(?)) > 0`, f.buscar);
  if (f.accion) condicion("data->>'accion' = ?", f.accion);
  if (f.desde) condicion("data->>'fecha' >= ?", f.desde + 'T00:00:00.000Z');
  // Fechas UTC y límite superior inclusivo hasta el último milisegundo.
  if (f.hasta) condicion("data->>'fecha' <= ?", f.hasta + 'T23:59:59.999Z');
  const where = condiciones.length ? ' WHERE ' + condiciones.join(' AND ') : '';
  const limite = 30;
  params.push(limite + 1, (f.pagina - 1) * limite);
  const r = await q('SELECT data FROM catalogo_historial' + where +
    " ORDER BY data->>'fecha' DESC, seq DESC LIMIT $" + (params.length - 1) + ' OFFSET $' + params.length, params);
  return { filtros: f, eventos: r.rows.slice(0, limite).map(x => x.data), hayMas: r.rows.length > limite };
}

asegurarDirectorios();

module.exports = {
  DATA_DIR: DATA_DIR,
  DB_FILE: DB_FILE,
  UPLOADS_DIR: UPLOADS_DIR,
  pool: pool,
  init: init,
  migrarDesdeJSON: migrarDesdeJSON,
  verificarMigracion: verificarMigracion,
  verificarConexion: verificarConexion,
  cerrar: cerrar,
  crearAgendamiento: crearAgendamiento,
  obtenerPorRef: obtenerPorRef,
  actualizarPorRef: actualizarPorRef,
  actualizarEstadoWompi,
  marcarTrabajoRealizado,
  procesarSiguienteAvisoRealizado,
  obtenerPorPedido: obtenerPorPedido,
  listarPorCliente: listarPorCliente,
  actualizarPorPedido: actualizarPorPedido,
  listarAgendamientos: listarAgendamientos,
  eliminarPorRef: eliminarPorRef,
  eliminarDefinitivamentePorRef: eliminarDefinitivamentePorRef,
  restaurarPorRef: restaurarPorRef,
  listarEliminados: listarEliminados,
  listarRealizados: listarRealizados,
  eliminarPendientesAntiguos: eliminarPendientesAntiguos,
  listarPendientesPagoWompi: listarPendientesPagoWompi,
  listarPromos: listarPromos,
  crearPromo: crearPromo,
  eliminarPromo: eliminarPromo,
  listarCodigos: listarCodigos,
  crearCodigo: crearCodigo,
  eliminarCodigo: eliminarCodigo,
  contarUsosCodigo: contarUsosCodigo,
  normalizarEmail: normalizarEmail,
  obtenerClientePorEmail: obtenerClientePorEmail,
  obtenerClientePorId: obtenerClientePorId,
  crearCliente: crearCliente,
  actualizarClientePorId: actualizarClientePorId,
  guardarCarritoCliente: guardarCarritoCliente,
  normalizarUsuario: normalizarUsuario,
  listarUsuariosAdmin: listarUsuariosAdmin,
  obtenerUsuarioAdmin: obtenerUsuarioAdmin,
  obtenerUsuarioAdminPorId: obtenerUsuarioAdminPorId,
  crearUsuarioAdmin: crearUsuarioAdmin,
  actualizarUsuarioAdmin: actualizarUsuarioAdmin,
  eliminarUsuarioAdmin: eliminarUsuarioAdmin,
  listarDestinatariosNotificaciones,
  obtenerDestinatarioNotificaciones,
  guardarDestinatarioNotificaciones,
  eliminarDestinatarioNotificaciones,
  registrarAcceso: registrarAcceso,
  listarAccesos: listarAccesos,
  listarCatalogo: listarCatalogo,
  listarAgendaPanel: listarAgendaPanel,
  resumenPanel: resumenPanel,
  listarCodigosConUsos: listarCodigosConUsos,
  listarCatalogoActivo: listarCatalogoActivo,
  obtenerCatalogoPorId: obtenerCatalogoPorId,
  guardarCatalogoItem: guardarCatalogoItem,
  actualizarCatalogoItem: actualizarCatalogoItem,
  eliminarCatalogoItem: eliminarCatalogoItem,
  listarHistorialCatalogo: listarHistorialCatalogo,
};
