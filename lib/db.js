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

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
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
    await client.query(`CREATE TABLE IF NOT EXISTS accesos (
      seq  BIGSERIAL PRIMARY KEY,
      data JSONB NOT NULL
    )`);
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

async function listarAgendamientos() {
  const r = await q("SELECT data FROM agendamientos ORDER BY data->>'creado_en' DESC NULLS LAST");
  return r.rows.map(function (x) { return x.data; });
}

async function obtenerPorPedido(pedidoRef) {
  if (!pedidoRef) return [];
  const r = await q("SELECT data FROM agendamientos WHERE data->>'pedido_ref' = $1 ORDER BY seq ASC", [pedidoRef]);
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
  eliminarAdjuntos(r.rows[0].data);
  await q('DELETE FROM agendamientos WHERE ref = $1', [ref]);
  return true;
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
  obtenerPorPedido: obtenerPorPedido,
  actualizarPorPedido: actualizarPorPedido,
  listarAgendamientos: listarAgendamientos,
  eliminarPorRef: eliminarPorRef,
  eliminarPendientesAntiguos: eliminarPendientesAntiguos,
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
  registrarAcceso: registrarAcceso,
  listarAccesos: listarAccesos,
};
