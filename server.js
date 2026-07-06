'use strict';

const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const db = require('./lib/db');
const mailer = require('./lib/mailer');
const templates = require('./lib/templates');
const exportar = require('./lib/exportar');

const app = express();
const PORT = parseInt(process.env.PORT || '5000', 10);
const ROOT = __dirname;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ASSISTANT_PASSWORD = process.env.ASSISTANT_PASSWORD || '';
const WOMPI_PUBLIC_KEY = process.env.WOMPI_PUBLIC_KEY || 'pub_test_gjhaZFqRwKaZMBcAEBYOjYNGqzGUyPXx';
// Secreto de integridad de Wompi (dashboard → Desarrolladores). Necesario para
// firmar el checkout: Wompi rechaza la transacción sin `signature:integrity`.
const WOMPI_INTEGRITY_SECRET = process.env.WOMPI_INTEGRITY_SECRET || '';
// Secreto de eventos de Wompi (dashboard → Desarrolladores → Eventos). Sirve para
// validar la firma de los webhooks. Es opcional: aunque no esté, el webhook
// reverifica cada transacción contra la API de Wompi antes de agendar.
const WOMPI_EVENTS_SECRET = process.env.WOMPI_EVENTS_SECRET || '';

// Firma de integridad Wompi = SHA256(referencia + montoEnCentavos + moneda + secreto).
function firmaIntegridadWompi(referencia, montoCentavos, moneda) {
  if (!WOMPI_INTEGRITY_SECRET) return '';
  const cadena = String(referencia) + String(montoCentavos) + String(moneda) + WOMPI_INTEGRITY_SECRET;
  return crypto.createHash('sha256').update(cadena).digest('hex');
}

// Contacto directo por WhatsApp (solo dígitos, con código de país). Se usa en la
// página de gracias y en "Mis consultas" para acompañar al cliente tras la compra.
const CONTACTO_WHATSAPP = (process.env.WHATSAPP || '18492472516').replace(/[^0-9]/g, '');

// Programa de fidelidad "Círculo íntimo": cada consulta pagada suma un sello y,
// al alcanzar el objetivo, el cliente desbloquea una recompensa.
const FIDELIDAD_OBJETIVO = 5;
const FIDELIDAD_RECOMPENSA = 'Una lectura corta de regalo ✦';

// Adelanto (urgencia): recargo fijo para entrega en un máximo de 2 días.
// Debe coincidir con el valor mostrado en el catálogo y en assets/wompi.js.
const ADELANTO_COP = 28000;
const ADELANTO_USD = '10';

// --- Comisión de Wompi (tarjetas): 2,65% + $700 COP + IVA (19% sobre la comisión). ---
// Se cobra al cliente calculando el bruto para que el negocio reciba el precio neto.
const WOMPI_COM_PCT = 0.0265;
const WOMPI_COM_FIJO = 700;
const WOMPI_IVA = 0.19;
function conComisionWompi(baseCop) {
  const factor = 1 - WOMPI_COM_PCT * (1 + WOMPI_IVA); // ≈ 0.968465
  const fijo = WOMPI_COM_FIJO * (1 + WOMPI_IVA);      // = 833
  return Math.ceil((baseCop + fijo) / factor);
}

// Formatea un monto en dólares: entero sin decimales, o con dos decimales.
function formatUsd(n) {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
}

// Nota: los pagos en dólares (USD) NO pasan por Wompi (que solo cobra en COP);
// se cobran por PayPal/AstroPay y se verifican manualmente, sin conversión a pesos.

// Precios válidos: se extraen del catálogo (index.html) para evitar montos manipulados.
function cargarPreciosValidos() {
  try {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const re = /\$\s*([0-9]{1,3}(?:\.[0-9]{3})+)/g;
    const set = new Set();
    let m;
    while ((m = re.exec(html)) !== null) {
      const val = parseInt(m[1].replace(/\./g, ''), 10);
      if (val > 999) set.add(val);
    }
    return set;
  } catch (e) {
    return new Set();
  }
}
const PRECIOS_VALIDOS = cargarPreciosValidos();

// Precios en dólares válidos del catálogo (para validar los pagos en USD, que se
// cobran por PayPal/AstroPay). Evita que se manipule el monto en dólares.
function cargarUsdValidos() {
  try {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const re = /([0-9]+(?:[.,][0-9]+)?)\s*USD/gi;
    const set = new Set();
    let m;
    while ((m = re.exec(html)) !== null) {
      const val = parseFloat(m[1].replace(',', '.'));
      if (val > 0) set.add(Math.round(val * 100) / 100);
    }
    return set;
  } catch (e) {
    return new Set();
  }
}
const USD_VALIDOS = cargarUsdValidos();

/* ---------- Catálogo de hechizos (para promociones/descuentos) ---------- */
// Los descuentos aplican SOLO a los hechizos. Se parsea la sección
// #hechizos-section de index.html para conocer cada hechizo y su precio base.
function decodificarEntidades(str) {
  return String(str || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

// Limpia el nombre del hechizo quitando iconos decorativos, para poder
// identificarlo de forma estable entre el frontend y el servidor.
function limpiarNombreHechizo(raw) {
  return decodificarEntidades(raw)
    .replace(/<[^>]+>/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ෆ⟡⊹˚꒦ᶻ𝗓𐰁ೀ𖥔ꗯಎ☼𝜗᭪𐙚✩ᵎ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cargarHechizos() {
  const mapa = {};
  const lista = [];
  try {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const ini = html.indexOf('id="hechizos-section"');
    const fin = html.indexOf('id="lecturas-section"');
    if (ini === -1) return { mapa: mapa, lista: lista };
    const seccion = html.slice(ini, fin === -1 ? html.length : fin);
    const reSpan = /<span class="p">([\s\S]*?)<\/span>/g;
    let m;
    while ((m = reSpan.exec(seccion)) !== null) {
      const contenido = m[1];
      const nombreMatch = contenido.match(/<strong>([\s\S]*?)<\/strong>/);
      const precioMatch = contenido.match(/\$\s*([0-9]{1,3}(?:\.[0-9]{3})+)/);
      if (!nombreMatch || !precioMatch) continue;
      const nombre = limpiarNombreHechizo(nombreMatch[1]);
      const precio = parseInt(precioMatch[1].replace(/\./g, ''), 10);
      if (!nombre || !precio || precio < 1000) continue;
      const clave = nombre.toLowerCase();
      if (mapa[clave]) {
        // Un mismo hechizo puede tener varios precios (variantes); se acumulan.
        if (mapa[clave].precios.indexOf(precio) === -1) mapa[clave].precios.push(precio);
        continue;
      }
      const hechizo = { clave: clave, nombre: nombre, precio_cop: precio, precios: [precio] };
      mapa[clave] = hechizo;
      lista.push(hechizo);
    }
  } catch (e) {
    /* noop */
  }
  return { mapa: mapa, lista: lista };
}
const HECHIZOS = cargarHechizos();

// Fecha actual (YYYY-MM-DD) en horario de Colombia para comparar ventanas.
function hoyBogota() {
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  } catch (e) {
    return new Date().toISOString().slice(0, 10);
  }
}

function enVentana(desde, hasta, hoy) {
  if (desde && hoy < desde) return false;
  if (hasta && hoy > hasta) return false;
  return true;
}

function objetivoIncluye(objetivo, clave) {
  if (objetivo === 'todos' || !objetivo) return true;
  return Array.isArray(objetivo) && objetivo.indexOf(clave) !== -1;
}

function aplicarDescuento(base, pct) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  return Math.round(base * (1 - p / 100));
}

// Descuento por promociones de fecha activas para un hechizo (auto-aplicadas).
async function descuentoFechaPara(clave) {
  const hoy = hoyBogota();
  let mejor = 0;
  const promos = await db.listarPromos();
  promos.forEach(function (p) {
    if (p.activa === false) return;
    if (!enVentana(p.desde, p.hasta, hoy)) return;
    if (!objetivoIncluye(p.objetivo, clave)) return;
    const pct = Number(p.porcentaje) || 0;
    if (pct > mejor) mejor = pct;
  });
  return mejor;
}

// Valida un código para un hechizo y devuelve su porcentaje (0 si no aplica).
async function codigoDescuentoPara(clave, codigoStr) {
  const cod = String(codigoStr || '').trim().toLowerCase();
  if (!cod) return { pct: 0, valido: false, codigo: '' };
  const hoy = hoyBogota();
  let encontrado = null;
  const codigos = await db.listarCodigos();
  codigos.forEach(function (c) {
    if (String(c.codigo || '').trim().toLowerCase() !== cod) return;
    if (c.activo === false) return;
    if (!enVentana(c.desde, c.hasta, hoy)) return;
    if (!objetivoIncluye(c.objetivo, clave)) return;
    encontrado = c;
  });
  if (!encontrado) return { pct: 0, valido: false, codigo: '' };
  const limite = Number(encontrado.limite_usos) || 0;
  if (limite > 0 && (await db.contarUsosCodigo(encontrado.codigo)) >= limite) {
    return { pct: 0, valido: false, codigo: '', agotado: true };
  }
  return { pct: Number(encontrado.porcentaje) || 0, valido: true, codigo: encontrado.codigo };
}

// Calcula el mejor descuento aplicable a un hechizo (no se acumulan: se toma el mayor).
// `base` es el precio base validado (algunos hechizos comparten nombre con precios
// distintos, por eso se usa el precio base recibido y no un mapa fijo).
async function calcularDescuentoHechizo(clave, codigoStr, base) {
  const h = HECHIZOS.mapa[clave];
  if (!h) return null;
  // El precio base debe corresponder realmente a este hechizo; así se evita
  // que un servicio que no es hechizo obtenga descuento enviando una clave válida.
  if (Array.isArray(h.precios) && h.precios.indexOf(base) === -1) return null;
  const pctFecha = await descuentoFechaPara(clave);
  const cod = await codigoDescuentoPara(clave, codigoStr);
  const pct = Math.max(pctFecha, cod.pct);
  const usaCodigo = cod.valido && cod.pct >= pctFecha && cod.pct > 0;
  const final = pct > 0 ? aplicarDescuento(base, pct) : base;
  return {
    base: base,
    pct: pct,
    final: final,
    fuente: pct === 0 ? '' : (usaCodigo ? 'codigo' : 'fecha'),
    codigoValido: cod.valido,
    codigoAplicado: usaCodigo ? cod.codigo : '',
  };
}

// Tipos de imagen permitidos (se excluye SVG para evitar XSS almacenado).
const TIPOS_IMAGEN = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

/* ---------- Secreto de sesión ---------- */
// En producción DEBE venir de la variable de entorno SESSION_SECRET: con varias
// instancias detrás del balanceador todas tienen que firmar la cookie con el
// mismo secreto, y un secreto por archivo/aleatorio invalidaría las sesiones al
// reiniciar o entre instancias. El respaldo por archivo se permite solo en
// desarrollo para no tener que configurar nada localmente.
function obtenerSecretoSesion() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET es obligatorio en producción; configúralo como variable de entorno.');
  }
  const archivo = path.join(db.DATA_DIR, '.session_secret');
  try {
    return fs.readFileSync(archivo, 'utf8');
  } catch (e) {
    const secreto = crypto.randomBytes(32).toString('hex');
    try { fs.writeFileSync(archivo, secreto); } catch (err) { /* noop */ }
    return secreto;
  }
}

/* ---------- Cuentas de cliente: hashing de contraseñas (Node core) ---------- */
// Se usa scrypt de la librería `crypto` de Node (JavaScript puro, sin dependencias
// nativas como bcrypt). El hash y la sal se guardan en hexadecimal.
function hashearPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), s, 64).toString('hex');
  return { salt: s, hash: hash };
}

function verificarPassword(password, salt, hashEsperado) {
  if (!salt || !hashEsperado) return false;
  let hash;
  try {
    hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  } catch (e) { return false; }
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(hashEsperado, 'hex');
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch (e) { return false; }
}

function emailValido(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

// Cliente autenticado en la sesión (independiente del acceso de administrador).
function clienteSesion(req) {
  return (req.session && req.session.cliente) || null;
}

// URL base pública (protocolo + host) para construir enlaces absolutos.
function baseUrlDe(req) {
  return req.protocol + '://' + req.get('host');
}

// Correo del cliente registrado dueño de un agendamiento (vacío si es invitado).
async function emailDelCliente(reg) {
  if (!reg || !reg.cliente_id) return '';
  try {
    const c = await db.obtenerClientePorId(reg.cliente_id);
    return (c && c.email) || '';
  } catch (e) {
    return '';
  }
}

// Aviso automático de estado a un cliente registrado (un solo servicio).
// Usa una bandera por estado para no repetir el mismo aviso.
async function notificarEstadoCliente(ref, estado) {
  const reg = await db.obtenerPorRef(ref);
  if (!reg) return;
  const to = await emailDelCliente(reg);
  if (!to) return;
  const bandera = 'cliente_aviso_' + estado;
  if (reg[bandera]) return;
  try {
    const r = await mailer.enviarEstadoCliente(estado, reg, to);
    if (r && r.enviado) {
      const cambios = {};
      cambios[bandera] = new Date().toISOString();
      await db.actualizarPorRef(ref, cambios);
    }
  } catch (e) {
    console.error('[mailer] Falló el aviso de estado al cliente:', e.message);
  }
}

// Aviso automático de estado para un pedido completo (carrito, varios servicios).
// Envía un único correo al cliente y marca todos los servicios del pedido.
async function notificarEstadoPedido(pedidoRef, estado) {
  const registros = await db.obtenerPorPedido(pedidoRef);
  if (!registros.length) return;
  const primero = registros[0];
  const to = await emailDelCliente(primero);
  if (!to) return;
  const bandera = 'cliente_aviso_' + estado;
  if (primero[bandera]) return;
  const datos = Object.assign({}, primero, {
    producto: registros.length > 1 ? ('Pedido de ' + registros.length + ' servicios') : primero.producto,
    precio_texto: '',
    ref: primero.pedido_ref,
  });
  try {
    const r = await mailer.enviarEstadoCliente(estado, datos, to);
    if (r && r.enviado) {
      const cambios = {};
      cambios[bandera] = new Date().toISOString();
      await db.actualizarPorPedido(pedidoRef, cambios);
    }
  } catch (e) {
    console.error('[mailer] Falló el aviso de estado (pedido) al cliente:', e.message);
  }
}

// Normaliza y sanea un ítem del carrito para almacenarlo/procesarlo.
function sanitizarItemCarrito(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const nombre = (raw.nombre || '').toString().trim();
  if (!nombre) return null;
  const precio = parseInt(raw.precio_cop, 10) || 0;
  const id = (raw.id || '').toString().slice(0, 60) ||
    (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  return {
    id: id,
    nombre: nombre.slice(0, 200),
    precio_cop: precio,
    precio_usd: (raw.precio_usd || '').toString().slice(0, 20),
    precio_texto: (raw.precio_texto || '').toString().slice(0, 120),
    es_hechizo: !!raw.es_hechizo,
    hechizo_clave: (raw.hechizo_clave || '').toString().trim().toLowerCase().slice(0, 120),
    es_extra: !!raw.es_extra,
    es_adelanto: !!raw.es_adelanto,
  };
}

function sanitizarCarrito(lista) {
  if (!Array.isArray(lista)) return [];
  return lista.map(sanitizarItemCarrito).filter(Boolean).slice(0, 30);
}

// Vista pública del cliente para el frontend (sin datos sensibles).
function clientePublico(cliente) {
  if (!cliente) return null;
  return {
    email: cliente.email,
    nombre: cliente.nombre || '',
    carrito: Array.isArray(cliente.carrito) ? cliente.carrito : [],
  };
}

// Evidencia visible para el dueño del agendamiento (fotos + notas + enlace
// público). Devuelve null si aún no hay evidencia cargada.
function evidenciaPublica(reg, baseUrl) {
  if (!reg || !reg.evidencia_en || !reg.evidencia_token) return null;
  const fotos = (Array.isArray(reg.evidencia_fotos) ? reg.evidencia_fotos : []).map(function (nombre) {
    return baseUrl + '/evidencia-foto/' + encodeURIComponent(reg.ref) + '/' + reg.evidencia_token + '/' + encodeURIComponent(nombre);
  });
  return {
    fotos: fotos,
    notas: reg.evidencia_notas || '',
    enlace: baseUrl + '/evidencia/' + encodeURIComponent(reg.ref) + '/' + reg.evidencia_token,
    en: reg.evidencia_en,
  };
}

// Construye el historial "Mis consultas" del cliente: agrupa los agendamientos
// por pedido (o por referencia individual), resume estado, trabajo realizado y
// evidencias, y calcula el progreso del programa de fidelidad "Círculo íntimo".
async function construirConsultas(clienteId, baseUrl) {
  const registros = await db.listarPorCliente(clienteId);
  const grupos = [];
  const indicePorClave = {};

  registros.forEach(function (reg) {
    const clave = reg.pedido_ref || reg.ref;
    let grupo = indicePorClave[clave];
    if (!grupo) {
      grupo = {
        clave: clave,
        pedido_ref: reg.pedido_ref || '',
        ref: reg.ref,
        creado_en: reg.creado_en || '',
        estado: reg.estado || 'agendado',
        metodo: reg.metodo || '',
        total_cop: reg.pedido_ref ? (parseInt(reg.pedido_total_cop, 10) || 0) : (parseInt(reg.precio_cop, 10) || 0),
        servicios: [],
      };
      indicePorClave[clave] = grupo;
      grupos.push(grupo);
    }
    grupo.servicios.push({
      producto: reg.producto || 'Servicio',
      precio_texto: reg.precio_texto || ('$' + (reg.precio_cop || 0).toLocaleString('es-CO') + ' COP'),
      trabajo_hecho: !!reg.trabajo_hecho,
      evidencia: evidenciaPublica(reg, baseUrl),
    });
  });

  // Estado y "trabajo realizado" a nivel de grupo: realizado solo cuando TODOS
  // los servicios del pedido están hechos.
  grupos.forEach(function (g) {
    g.trabajo_hecho = g.servicios.length > 0 && g.servicios.every(function (s) { return s.trabajo_hecho; });
    g.tiene_evidencia = g.servicios.some(function (s) { return s.evidencia; });
  });

  // Fidelidad: un sello por cada servicio con el pago confirmado (agendado).
  const sellos = registros.filter(function (r) { return r.estado === 'agendado'; }).length;
  const objetivo = FIDELIDAD_OBJETIVO;
  const desbloqueada = sellos >= objetivo;
  const fidelidad = {
    sellos: sellos,
    objetivo: objetivo,
    faltan: Math.max(0, objetivo - sellos),
    desbloqueada: desbloqueada,
    recompensa: FIDELIDAD_RECOMPENSA,
  };

  // Persiste el progreso en el registro del cliente (para tenerlo a mano y poder
  // reconocer la recompensa desde el panel si hiciera falta).
  try {
    await db.actualizarClientePorId(clienteId, {
      sellos: sellos,
      recompensa_desbloqueada: desbloqueada,
    });
  } catch (e) { /* el progreso es informativo; un fallo aquí no rompe la vista */ }

  return { grupos: grupos, fidelidad: fidelidad };
}

app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(session({
  name: 'fresa.sid',
  store: new pgSession({ pool: db.pool, tableName: 'session', createTableIfMissing: true }),
  secret: obtenerSecretoSesion(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 8,
  },
}));

/* ---------- Subida de fotos ---------- */
const storage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, db.UPLOADS_DIR); },
  filename: function (req, file, cb) {
    const ext = TIPOS_IMAGEN[file.mimetype] || '.jpg';
    cb(null, Date.now() + '-' + crypto.randomBytes(6).toString('hex') + ext);
  },
});
const upload = multer({
  storage: storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    if (TIPOS_IMAGEN[file.mimetype]) cb(null, true);
    else cb(new Error('Formato no permitido. Sube una imagen JPG, PNG o WEBP.'));
  },
});

/* ---------- Verificación de la transacción en Wompi ---------- */
function baseApiWompi() {
  return WOMPI_PUBLIC_KEY.indexOf('pub_prod') === 0
    ? 'https://production.wompi.co/v1'
    : 'https://sandbox.wompi.co/v1';
}

async function verificarTransaccionWompi(txId) {
  const resp = await fetch(baseApiWompi() + '/transactions/' + encodeURIComponent(txId));
  if (!resp.ok) return null;
  const json = await resp.json();
  return json && json.data ? json.data : null;
}

// Busca transacciones por REFERENCIA (sin conocer el id). Sirve para
// reconciliar pagos que el cliente completó en Wompi pero cuyo regreso al
// sitio o cuyo webhook nunca llegaron (pestaña cerrada, red caída, webhook no
// entregado): así se agendan igual, en vez de quedar "pendiente_pago" para
// siempre y terminar borrados por la limpieza automática.
async function buscarTransaccionesPorReferencia(referencia) {
  try {
    const resp = await fetch(baseApiWompi() + '/transactions?reference=' + encodeURIComponent(referencia));
    if (!resp.ok) return [];
    const json = await resp.json();
    return Array.isArray(json && json.data) ? json.data : [];
  } catch (e) {
    console.error('[wompi] Falló la búsqueda por referencia:', referencia, e.message);
    return [];
  }
}

/* ---------- Confirmación de pago (compartida por el regreso web y el webhook) ---------- */
// Reverifica la transacción contra Wompi y, si está aprobada y coincide con el
// registro (referencia, monto, moneda), lo agenda y notifica. Es idempotente:
// si ya está agendado o es un pago manual en verificación, no hace nada.
async function confirmarPagoRef(ref, txId) {
  const registro = await db.obtenerPorRef(ref);
  if (!registro) return { encontrado: false };
  if (registro.estado === 'agendado') return { encontrado: true, yaAgendado: true };
  if (registro.estado === 'pendiente_verificacion') return { encontrado: true, manual: true };
  if (!txId) return { encontrado: true };

  const tx = await verificarTransaccionWompi(txId);
  const montoOk = tx && Number(tx.amount_in_cents) === registro.precio_cop * 100;
  const monedaOk = tx && tx.currency === 'COP';
  const refOk = tx && tx.reference === ref;
  if (tx && tx.status === 'APPROVED' && refOk && montoOk && monedaOk) {
    const actualizado = await db.actualizarPorRef(ref, {
      estado: 'agendado',
      wompi_tx: txId,
      pagado_en: new Date().toISOString(),
    });
    if (!registro.correo_enviado) {
      try {
        const r = await mailer.enviarNotificacion(actualizado);
        if (r.enviado) await db.actualizarPorRef(ref, { correo_enviado: true });
      } catch (e) {
        console.error('[mailer] Falló el envío de la notificación:', e.message);
      }
    }
    await notificarEstadoCliente(ref, 'agendado');
    return { encontrado: true, agendado: true };
  }
  if (tx && ['DECLINED', 'ERROR', 'VOIDED'].indexOf(tx.status) !== -1) {
    return { encontrado: true, rechazado: true };
  }
  return { encontrado: true };
}

// Igual que confirmarPagoRef pero para un pedido completo (varios servicios, un
// solo pago). Al confirmarse, vacía el carrito guardado del cliente.
async function confirmarPagoPedido(pedidoRef, txId) {
  let registros = await db.obtenerPorPedido(pedidoRef);
  if (!registros.length) return { encontrado: false };
  const primero = registros[0];
  if (primero.estado === 'agendado') return { encontrado: true, yaAgendado: true, registros: registros };
  if (primero.estado === 'pendiente_verificacion') return { encontrado: true, manual: true, registros: registros };
  if (!txId) return { encontrado: true, registros: registros };

  const totalPedido = parseInt(primero.pedido_total_cop, 10) || 0;
  const tx = await verificarTransaccionWompi(txId);
  const montoOk = tx && Number(tx.amount_in_cents) === totalPedido * 100;
  const monedaOk = tx && tx.currency === 'COP';
  const refOk = tx && tx.reference === pedidoRef;
  if (tx && tx.status === 'APPROVED' && refOk && montoOk && monedaOk) {
    await db.actualizarPorPedido(pedidoRef, {
      estado: 'agendado',
      wompi_tx: txId,
      pagado_en: new Date().toISOString(),
    });
    if (primero.cliente_id) {
      try { await db.guardarCarritoCliente(primero.cliente_id, []); } catch (e) { /* noop */ }
    }
    registros = await db.obtenerPorPedido(pedidoRef);
    if (!primero.correo_enviado) {
      try {
        const r = await mailer.enviarNotificacionPedido(registros, totalPedido);
        if (r.enviado) await db.actualizarPorPedido(pedidoRef, { correo_enviado: true });
      } catch (e) {
        console.error('[mailer] Falló la notificación del pedido:', e.message);
      }
    }
    await notificarEstadoPedido(pedidoRef, 'agendado');
    return { encontrado: true, agendado: true, registros: registros };
  }
  if (tx && ['DECLINED', 'ERROR', 'VOIDED'].indexOf(tx.status) !== -1) {
    return { encontrado: true, rechazado: true, registros: registros };
  }
  return { encontrado: true, registros: registros };
}

/* ---------- Config pública para el frontend ---------- */
app.get('/api/config', function (req, res) {
  res.json({
    wompiPublicKey: WOMPI_PUBLIC_KEY,
    comision: { pct: WOMPI_COM_PCT, fijo: WOMPI_COM_FIJO, iva: WOMPI_IVA },
    whatsapp: CONTACTO_WHATSAPP,
  });
});

/* ---------- Promociones activas por fecha (para mostrar precios rebajados) ---------- */
app.get('/api/promociones', async function (req, res) {
  const descuentos = {};
  for (const h of HECHIZOS.lista) {
    const pct = await descuentoFechaPara(h.clave);
    if (pct > 0) descuentos[h.clave] = pct;
  }
  res.json({ descuentos: descuentos });
});

/* ---------- Validar un código promocional para un hechizo ---------- */
app.post('/api/codigo', async function (req, res) {
  const b = req.body || {};
  const clave = (b.hechizo_clave || '').toString().trim().toLowerCase();
  const codigo = (b.codigo || '').toString().trim();
  if (!clave || !HECHIZOS.mapa[clave]) {
    return res.status(400).json({ ok: false, error: 'Los códigos solo aplican a los hechizos.' });
  }
  const cod = await codigoDescuentoPara(clave, codigo);
  if (!cod.valido || cod.pct <= 0) {
    const msg = cod.agotado
      ? 'Este código ya alcanzó su límite de usos.'
      : 'El código no es válido o no aplica a este hechizo.';
    return res.status(400).json({ ok: false, error: msg });
  }
  res.json({ ok: true, porcentaje: cod.pct });
});

/* ---------- Cuentas de cliente (correo + contraseña) ---------- */
// Estado de la sesión del cliente (para que el frontend sepa si hay sesión y
// recupere el carrito guardado en el servidor).
app.get('/api/cuenta', async function (req, res) {
  const sesion = clienteSesion(req);
  if (!sesion) return res.json({ autenticado: false });
  const cliente = await db.obtenerClientePorId(sesion.id);
  if (!cliente) {
    delete req.session.cliente;
    return res.json({ autenticado: false });
  }
  res.json({ autenticado: true, cliente: clientePublico(cliente) });
});

app.post('/api/cuenta/registro', mismoOrigen, async function (req, res) {
  const b = req.body || {};
  const email = db.normalizarEmail(b.email);
  const password = (b.password || '').toString();
  const nombre = (b.nombre || '').toString().trim().slice(0, 160);
  if (!emailValido(email)) {
    return res.status(400).json({ ok: false, error: 'Escribe un correo electrónico válido.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ ok: false, error: 'La contraseña debe tener al menos 6 caracteres.' });
  }
  if (await db.obtenerClientePorEmail(email)) {
    return res.status(409).json({ ok: false, error: 'Ya existe una cuenta con este correo. Inicia sesión.' });
  }
  const cred = hashearPassword(password);
  // El carrito enviado por el navegador (invitado) se conserva al crear la cuenta.
  const carrito = sanitizarCarrito(b.carrito);
  const cliente = await db.crearCliente({
    id: 'cli-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex'),
    email: email,
    nombre: nombre,
    pass_hash: cred.hash,
    pass_salt: cred.salt,
    carrito: carrito,
    creado_en: new Date().toISOString(),
  });
  req.session.cliente = { id: cliente.id, email: cliente.email, nombre: cliente.nombre };
  res.json({ ok: true, cliente: clientePublico(cliente) });
});

app.post('/api/cuenta/login', mismoOrigen, async function (req, res) {
  const b = req.body || {};
  const email = db.normalizarEmail(b.email);
  const password = (b.password || '').toString();
  const cliente = await db.obtenerClientePorEmail(email);
  if (!cliente || !verificarPassword(password, cliente.pass_salt, cliente.pass_hash)) {
    return res.status(401).json({ ok: false, error: 'Correo o contraseña incorrectos.' });
  }
  // Al iniciar sesión se fusiona el carrito del navegador con el guardado en el
  // servidor (sin duplicar ítems idénticos). El resultado se persiste.
  const delNavegador = sanitizarCarrito(b.carrito);
  const guardado = Array.isArray(cliente.carrito) ? cliente.carrito : [];
  const fusion = guardado.slice();
  const firma = function (it) {
    return [it.nombre, it.precio_cop, it.hechizo_clave, it.es_extra, it.es_adelanto].join('|');
  };
  const vistos = {};
  fusion.forEach(function (it) { vistos[firma(it)] = true; });
  delNavegador.forEach(function (it) {
    if (!vistos[firma(it)]) { fusion.push(it); vistos[firma(it)] = true; }
  });
  const actualizado = (await db.guardarCarritoCliente(cliente.id, fusion)) || cliente;
  req.session.cliente = { id: cliente.id, email: cliente.email, nombre: cliente.nombre };
  res.json({ ok: true, cliente: clientePublico(actualizado) });
});

app.post('/api/cuenta/logout', mismoOrigen, function (req, res) {
  // Solo cierra la sesión del cliente; no afecta la sesión de administrador.
  if (req.session) delete req.session.cliente;
  res.json({ ok: true });
});

// Guarda (reemplaza) el carrito del cliente autenticado en el servidor.
app.put('/api/carrito', mismoOrigen, async function (req, res) {
  const sesion = clienteSesion(req);
  if (!sesion) return res.status(401).json({ ok: false, error: 'Inicia sesión para guardar tu carrito.' });
  const carrito = sanitizarCarrito((req.body || {}).carrito);
  const actualizado = await db.guardarCarritoCliente(sesion.id, carrito);
  if (!actualizado) return res.status(404).json({ ok: false, error: 'Cuenta no encontrada.' });
  res.json({ ok: true, carrito: actualizado.carrito || [] });
});

// Historial "Mis consultas" del cliente autenticado: pedidos con su estado,
// evidencias y el progreso del programa de fidelidad.
app.get('/api/cuenta/consultas', async function (req, res) {
  const sesion = clienteSesion(req);
  if (!sesion) return res.status(401).json({ ok: false, error: 'Inicia sesión para ver tus consultas.' });
  try {
    const datos = await construirConsultas(sesion.id, baseUrlDe(req));
    res.json({ ok: true, grupos: datos.grupos, fidelidad: datos.fidelidad });
  } catch (e) {
    console.error('[consultas]', e.message);
    res.status(500).json({ ok: false, error: 'No se pudieron cargar tus consultas.' });
  }
});

/* ---------- Registrar agendamiento (antes de pagar) ---------- */
const subirArchivos = upload.fields([
  { name: 'objetivo_foto', maxCount: 1 },
  { name: 'comprobante', maxCount: 1 },
]);

app.post('/api/booking', function (req, res) {
  subirArchivos(req, res, async function (err) {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'La imagen es demasiado grande (máximo 8 MB).'
        : (err.message || 'No se pudo subir la imagen.');
      return res.status(400).json({ error: msg });
    }
    try {
      const b = req.body || {};
      const fotoFile = req.files && req.files.objetivo_foto && req.files.objetivo_foto[0];
      const comprobanteFile = req.files && req.files.comprobante && req.files.comprobante[0];

      const clienteNombre = (b.cliente_nombre || '').toString().trim();
      if (!clienteNombre) return res.status(400).json({ error: 'Escribe tu nombre y apellido.' });

      const esTransferencia = (b.metodo || '').toString().trim() === 'transferencia';
      const moneda = (b.moneda || 'cop').toString().toLowerCase() === 'usd' ? 'usd' : 'cop';
      // Manual = transferencia (se verifica el comprobante a mano). El pago en
      // dólares por transferencia se cobra por PayPal/AstroPay; en dólares por
      // Wompi se cobra el precio en pesos del catálogo (Wompi solo cobra COP).
      const esManual = esTransferencia;
      const usdManual = moneda === 'usd' && esManual;

      // Falla en seguro: sin el secreto de integridad, Wompi rechazaría el pago.
      // Evitamos crear un agendamiento y redirigir a un checkout que dará error.
      if (!esManual && !WOMPI_INTEGRITY_SECRET) {
        console.error('[booking] WOMPI_INTEGRITY_SECRET no configurado');
        return res.status(503).json({ error: 'El pago con tarjeta no está disponible por ahora. Intenta con transferencia o escríbenos.' });
      }

      // --- Servicios extra (complementos de los hechizos): formulario corto ---
      // Adelanto/urgencia, velación, ocultamiento, velita... Solo se piden el
      // nombre del cliente y los hechizos (máximo 3) a los que se aplica el extra.
      // No se piden datos de la persona ni de contacto.
      const esAdelantoSolo = (b.adelanto || '').toString().trim() === 'solo';
      const esExtra = esAdelantoSolo || (b.tipo || '').toString().trim() === 'extra';
      if (esExtra) {
        const hechizosTexto = (b.info_extra || '').toString().trim();
        if (!hechizosTexto) {
          return res.status(400).json({ error: 'Escribe a cuál(es) hechizo(s) se aplica este extra.' });
        }
        if (esManual && !comprobanteFile) {
          return res.status(400).json({ error: 'Sube el comprobante de tu pago.' });
        }

        // Precio del extra: para el adelanto es un valor fijo del servidor; para
        // los demás extras debe corresponder a un precio real del catálogo.
        let baseExtra, usdExtra, nombreExtra;
        if (esAdelantoSolo) {
          baseExtra = ADELANTO_COP;
          usdExtra = parseFloat(ADELANTO_USD);
          nombreExtra = 'Adelanto (urgencia)';
        } else {
          baseExtra = parseInt(b.precio_cop, 10);
          if (!baseExtra || baseExtra < 1000) {
            return res.status(400).json({ error: 'El precio no es válido.' });
          }
          if (PRECIOS_VALIDOS.size && !PRECIOS_VALIDOS.has(baseExtra)) {
            return res.status(400).json({ error: 'El precio no corresponde a ningún servicio del catálogo.' });
          }
          usdExtra = parseFloat((b.precio_usd || '').toString().replace(',', '.'));
          nombreExtra = (b.producto || 'Extra').toString().slice(0, 200);
        }

        let totalExtra, precioTextoExtra, precioUsdExtra;
        if (usdManual) {
          // Pago en dólares por transferencia: PayPal/AstroPay, sin conversión.
          if (isNaN(usdExtra)) {
            return res.status(400).json({ error: 'Este extra no tiene precio en dólares. Paga en pesos (COP).' });
          }
          if (!esAdelantoSolo && USD_VALIDOS.size && !USD_VALIDOS.has(Math.round(usdExtra * 100) / 100)) {
            return res.status(400).json({ error: 'El precio en dólares no corresponde a ningún servicio del catálogo.' });
          }
          totalExtra = 0;
          precioUsdExtra = formatUsd(usdExtra);
          precioTextoExtra = '$' + precioUsdExtra + ' USD';
        } else {
          totalExtra = !esTransferencia ? conComisionWompi(baseExtra) : baseExtra;
          precioUsdExtra = isNaN(usdExtra) ? '' : formatUsd(usdExtra);
          precioTextoExtra = '$' + baseExtra.toLocaleString('es-CO') + ' COP' +
            (!esTransferencia ? ' · Total $' + totalExtra.toLocaleString('es-CO') + ' COP (incluye comisión Wompi)' : '');
        }

        const refA = 'FRESA-' + Date.now() + '-' + Math.floor(Math.random() * 9999);
        const registroA = {
          ref: refA,
          producto: nombreExtra,
          precio_cop: totalExtra,
          precio_usd: precioUsdExtra,
          precio_texto: precioTextoExtra.slice(0, 180),
          precio_original: '',
          descuento_pct: '',
          codigo_promo: '',
          metodo: esManual ? 'transferencia' : 'wompi',
          cliente_id: clienteSesion(req) ? clienteSesion(req).id : '',
          cliente_nombre: clienteNombre.slice(0, 160),
          contacto: '',
          objetivo_nombre: '',
          objetivo_fecha_nac: '',
          objetivo_foto: '',
          comprobante: comprobanteFile ? comprobanteFile.filename : '',
          info_extra: hechizosTexto.slice(0, 2000),
          adelanto: esAdelantoSolo ? 'solo' : 'extra',
          estado: esManual ? 'pendiente_verificacion' : 'pendiente_pago',
          wompi_tx: '',
          correo_enviado: false,
          creado_en: new Date().toISOString(),
          pagado_en: '',
        };
        await db.crearAgendamiento(registroA);
        return res.json({
          ok: true, ref: refA, precio_cop: totalExtra, precio_texto: registroA.precio_texto,
          signature: esManual ? '' : firmaIntegridadWompi(refA, totalExtra * 100, 'COP'),
        });
      }

      const contacto = (b.contacto || '').toString().trim();
      if (!contacto) return res.status(400).json({ error: 'Escribe tu WhatsApp o red social para entregarte la evidencia.' });

      // El precio base siempre debe corresponder a un servicio del catálogo.
      const base = parseInt(b.precio_cop, 10);
      if (!base || base < 1000) return res.status(400).json({ error: 'El precio no es válido.' });
      if (PRECIOS_VALIDOS.size && !PRECIOS_VALIDOS.has(base)) {
        return res.status(400).json({ error: 'El precio no corresponde a ningún servicio del catálogo.' });
      }

      // Precio autoritativo: para hechizos se aplica el descuento (promoción por
      // fecha o código) sobre el precio base, recalculado siempre en el servidor.
      const claveEnviada = (b.hechizo_clave || '').toString().trim().toLowerCase();
      const codigoEnviado = (b.codigo || '').toString().trim();
      const info = claveEnviada ? await calcularDescuentoHechizo(claveEnviada, codigoEnviado, base) : null;

      // El precio en USD se recalcula en paralelo al COP para reflejar el descuento
      // y el adelanto. Es el monto cobrado si se paga en dólares por transferencia
      // (PayPal/AstroPay); en pesos o por Wompi es solo informativo.
      let usdNum = parseFloat((b.precio_usd || '').toString().replace(',', '.'));
      const usdBase = usdNum; // valor base en USD (antes de descuento/adelanto)
      let precioUsd = (b.precio_usd || '').toString().slice(0, 20);
      const fmtUsd = (n) => {
        const r = Math.round(n * 100) / 100;
        return Number.isInteger(r) ? String(r) : r.toFixed(2);
      };

      let precio = base;
      let precioTexto;
      let precioOriginal = 0;
      let descuentoPct = 0;
      let codigoAplicado = '';
      if (info && info.pct > 0) {
        precio = info.final;
        precioOriginal = info.base;
        descuentoPct = info.pct;
        codigoAplicado = info.codigoAplicado;
        precioTexto = '$' + precio.toLocaleString('es-CO') + ' COP (-' + info.pct + '%)';
        if (!isNaN(usdNum)) {
          usdNum = usdNum * (1 - info.pct / 100);
          precioTexto += ' · ' + fmtUsd(usdNum) + ' USD';
        }
      } else {
        precioTexto = (b.precio_texto || ('$' + precio + ' COP')).toString().slice(0, 80);
      }

      // Adelanto (urgencia) añadido a un hechizo: recargo fijo sobre el total.
      // Solo aplica a hechizos reales del catálogo (info != null exige que la
      // clave y el precio base coincidan con un hechizo existente). Si llega la
      // marca sin un hechizo válido, se rechaza para no aceptar datos manipulados.
      let adelanto = '';
      if ((b.incluye_adelanto || '').toString().trim() === '1') {
        if (!info) {
          return res.status(400).json({ error: 'El adelanto solo está disponible para los hechizos.' });
        }
        precio += ADELANTO_COP;
        adelanto = 'incluido';
        precioTexto = '$' + precio.toLocaleString('es-CO') + ' COP' +
          (descuentoPct ? ' (-' + descuentoPct + '% + adelanto)' : ' (incluye adelanto)');
        if (!isNaN(usdNum)) {
          usdNum += parseFloat(ADELANTO_USD);
          precioTexto += ' · ' + fmtUsd(usdNum) + ' USD';
        }
      }
      if (!isNaN(usdNum)) precioUsd = fmtUsd(usdNum);

      const objNombre = (b.objetivo_nombre || '').toString().trim();
      const objFecha = (b.objetivo_fecha_nac || '').toString().trim();
      const tieneFoto = !!fotoFile;
      if (!objNombre && !objFecha && !tieneFoto) {
        return res.status(400).json({ error: 'Proporciona el nombre o la fecha de nacimiento de la persona, o sube una foto.' });
      }

      if (esManual && !comprobanteFile) {
        return res.status(400).json({ error: 'Sube el comprobante de tu pago.' });
      }

      if (usdManual) {
        if (isNaN(usdBase)) {
          return res.status(400).json({ error: 'Este servicio no tiene precio en dólares. Paga en pesos (COP).' });
        }
        // El precio en dólares debe corresponder a un servicio real del catálogo.
        if (USD_VALIDOS.size && !USD_VALIDOS.has(Math.round(usdBase * 100) / 100)) {
          return res.status(400).json({ error: 'El precio en dólares no corresponde a ningún servicio del catálogo.' });
        }
      }
      let totalCop, precioTextoFinal;
      if (usdManual) {
        // Pago en dólares por transferencia: PayPal/AstroPay, sin conversión.
        totalCop = 0;
        precioTextoFinal = '$' + precioUsd + ' USD';
      } else {
        totalCop = !esTransferencia ? conComisionWompi(precio) : precio;
        precioTextoFinal = precioTexto +
          (!esTransferencia ? ' · Total $' + totalCop.toLocaleString('es-CO') + ' COP (incluye comisión Wompi)' : '');
      }

      const ref = 'FRESA-' + Date.now() + '-' + Math.floor(Math.random() * 9999);
      const registro = {
        ref: ref,
        producto: (b.producto || '').toString().slice(0, 200),
        precio_cop: totalCop,
        precio_usd: precioUsd,
        precio_texto: precioTextoFinal.slice(0, 180),
        precio_original: precioOriginal || '',
        descuento_pct: descuentoPct || '',
        codigo_promo: codigoAplicado || '',
        metodo: esManual ? 'transferencia' : 'wompi',
        cliente_id: clienteSesion(req) ? clienteSesion(req).id : '',
        cliente_nombre: clienteNombre.slice(0, 160),
        contacto: contacto.slice(0, 200),
        objetivo_nombre: objNombre.slice(0, 200),
        objetivo_fecha_nac: objFecha.slice(0, 40),
        objetivo_foto: fotoFile ? fotoFile.filename : '',
        comprobante: comprobanteFile ? comprobanteFile.filename : '',
        info_extra: (b.info_extra || '').toString().trim().slice(0, 2000),
        adelanto: adelanto,
        estado: esManual ? 'pendiente_verificacion' : 'pendiente_pago',
        wompi_tx: '',
        correo_enviado: false,
        creado_en: new Date().toISOString(),
        pagado_en: '',
      };
      await db.crearAgendamiento(registro);
      res.json({
        ok: true, ref: ref, precio_cop: totalCop, precio_texto: registro.precio_texto,
        signature: esManual ? '' : firmaIntegridadWompi(ref, totalCop * 100, 'COP'),
      });
    } catch (e) {
      console.error('[booking]', e);
      res.status(500).json({ error: 'No se pudo registrar. Intenta de nuevo.' });
    }
  });
});

/* ---------- Regreso desde Wompi: verifica pago, agenda y notifica ---------- */
app.get('/gracias/:ref', async function (req, res) {
  const ref = req.params.ref;
  const registro = await db.obtenerPorRef(ref);
  if (!registro) {
    return res.status(404).send(templates.paginaGracias({ estado: 'no_encontrado' }));
  }

  const txId = req.query.id;
  let estado;
  if (registro.estado === 'agendado') estado = 'agendado';
  else if (registro.estado === 'pendiente_verificacion') estado = 'comprobante_recibido';
  else estado = 'verificando';

  if (txId && registro.estado !== 'agendado' && registro.estado !== 'pendiente_verificacion') {
    try {
      const r = await confirmarPagoRef(ref, txId);
      if (r.agendado || r.yaAgendado) estado = 'agendado';
      else if (r.rechazado) estado = 'rechazado';
    } catch (e) {
      console.error('[wompi] Falló la verificación:', e.message);
    }
  }

  const regActual = (await db.obtenerPorRef(ref)) || registro;
  res.send(templates.paginaGracias({ estado: estado, reg: regActual, whatsapp: CONTACTO_WHATSAPP }));
});

/* ---------- Checkout combinado del carrito (varios servicios, un solo pago) ---------- */
// Acepta nombres de archivo dinámicos (foto_0, foto_1, ... y comprobante).
const subirArchivosCheckout = upload.any();

app.post('/api/checkout', function (req, res) {
  subirArchivosCheckout(req, res, async function (err) {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'Una de las imágenes es demasiado grande (máximo 8 MB).'
        : (err.message || 'No se pudo subir una imagen.');
      return res.status(400).json({ ok: false, error: msg });
    }
    try {
      const b = req.body || {};
      const archivos = Array.isArray(req.files) ? req.files : [];
      const archivoPorCampo = {};
      archivos.forEach(function (f) { archivoPorCampo[f.fieldname] = f; });

      let items;
      try {
        items = JSON.parse(b.items || '[]');
      } catch (e) {
        return res.status(400).json({ ok: false, error: 'El carrito no es válido.' });
      }
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ ok: false, error: 'Tu carrito está vacío.' });
      }
      if (items.length > 30) {
        return res.status(400).json({ ok: false, error: 'Demasiados servicios en el carrito.' });
      }

      const clienteNombre = (b.cliente_nombre || '').toString().trim();
      if (!clienteNombre) return res.status(400).json({ ok: false, error: 'Escribe tu nombre y apellido.' });

      const contacto = (b.contacto || '').toString().trim();
      const esTransferencia = (b.metodo || '').toString().trim() === 'transferencia';
      const esManual = esTransferencia;

      // Falla en seguro: sin secreto de integridad, Wompi rechazaría el pago.
      if (!esManual && !WOMPI_INTEGRITY_SECRET) {
        console.error('[checkout] WOMPI_INTEGRITY_SECRET no configurado');
        return res.status(503).json({ ok: false, error: 'El pago con tarjeta no está disponible por ahora. Intenta con transferencia o escríbenos.' });
      }

      const comprobanteFile = archivoPorCampo['comprobante'];
      if (esManual && !comprobanteFile) {
        return res.status(400).json({ ok: false, error: 'Sube el comprobante de tu pago.' });
      }

      // Se requiere contacto si hay algún servicio que no sea un extra (los extras
      // no necesitan datos de la persona ni de contacto).
      const hayServicioNormal = items.some(function (it) { return !it.es_extra && !it.es_adelanto; });
      if (hayServicioNormal && !contacto) {
        return res.status(400).json({ ok: false, error: 'Escribe tu WhatsApp o red social para entregarte la evidencia.' });
      }

      // --- Validación y cálculo de precios AUTORITATIVO en el servidor ---
      const preparados = [];
      let totalNeto = 0;
      for (let i = 0; i < items.length; i++) {
        const it = items[i] || {};
        const esAdelanto = !!it.es_adelanto;
        const esExtra = esAdelanto || !!it.es_extra;

        let base, nombre, precioUsd;
        if (esAdelanto) {
          base = ADELANTO_COP;
          nombre = 'Adelanto (urgencia)';
          precioUsd = ADELANTO_USD;
        } else {
          base = parseInt(it.precio_cop, 10);
          if (!base || base < 1000) {
            return res.status(400).json({ ok: false, error: 'Uno de los servicios tiene un precio no válido.' });
          }
          if (PRECIOS_VALIDOS.size && !PRECIOS_VALIDOS.has(base)) {
            return res.status(400).json({ ok: false, error: 'Un precio no corresponde a ningún servicio del catálogo.' });
          }
          nombre = (it.nombre || 'Servicio').toString().slice(0, 200);
          precioUsd = (it.precio_usd || '').toString().slice(0, 20);
        }

        // Descuentos automáticos por fecha SOLO para hechizos reales (no se piden
        // códigos en el carrito; cada servicio conserva su precio de catálogo).
        let precioNeto = base;
        let descuentoPct = 0;
        let precioOriginal = 0;
        if (!esExtra && it.es_hechizo && it.hechizo_clave) {
          const info = await calcularDescuentoHechizo(
            it.hechizo_clave.toString().trim().toLowerCase(), '', base);
          if (info && info.pct > 0) {
            precioNeto = info.final;
            descuentoPct = info.pct;
            precioOriginal = info.base;
          }
        }

        let precioTexto = '$' + precioNeto.toLocaleString('es-CO') + ' COP' +
          (descuentoPct ? ' (-' + descuentoPct + '%)' : '');

        // Datos por servicio (recogidos en el checkout).
        let objNombre = '', objFecha = '', infoExtra = '', fotoFile = null;
        if (esExtra) {
          infoExtra = (it.info_extra || '').toString().trim().slice(0, 2000);
          if (!infoExtra) {
            return res.status(400).json({ ok: false, error: 'Indica a cuál(es) hechizo(s) se aplica: ' + nombre + '.' });
          }
        } else {
          objNombre = (it.objetivo_nombre || '').toString().trim().slice(0, 200);
          objFecha = (it.objetivo_fecha_nac || '').toString().trim().slice(0, 40);
          infoExtra = (it.info_extra || '').toString().trim().slice(0, 2000);
          const campoFoto = (it.foto_campo || '').toString();
          fotoFile = campoFoto ? archivoPorCampo[campoFoto] : null;
          if (!objNombre && !objFecha && !fotoFile) {
            return res.status(400).json({ ok: false, error: 'Faltan los datos de la persona para: ' + nombre + '.' });
          }
        }

        totalNeto += precioNeto;
        preparados.push({
          nombre: nombre,
          precioNeto: precioNeto,
          precioUsd: precioUsd,
          precioTexto: precioTexto,
          precioOriginal: precioOriginal,
          descuentoPct: descuentoPct,
          esAdelanto: esAdelanto,
          esExtra: esExtra,
          objNombre: objNombre,
          objFecha: objFecha,
          infoExtra: infoExtra,
          fotoFile: fotoFile,
        });
      }

      // La comisión de Wompi se aplica UNA sola vez sobre el total (no por servicio).
      const totalCobro = esTransferencia ? totalNeto : conComisionWompi(totalNeto);
      const pedidoRef = 'FRESA-PED-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex');
      const creadoEn = new Date().toISOString();
      // Se guarda el cliente dueño del pedido (si hay sesión) para vaciar su
      // carrito guardado SOLO cuando el pago quede confirmado.
      const sesionCheckout = clienteSesion(req);
      const clienteId = sesionCheckout ? sesionCheckout.id : '';

      for (let i = 0; i < preparados.length; i++) {
        const p = preparados[i];
        const registro = {
          ref: pedidoRef + '-' + (i + 1),
          pedido_ref: pedidoRef,
          pedido_total_cop: totalCobro,
          cliente_id: clienteId,
          producto: p.nombre,
          precio_cop: p.precioNeto,
          precio_usd: p.precioUsd,
          precio_texto: p.precioTexto.slice(0, 180),
          precio_original: p.precioOriginal || '',
          descuento_pct: p.descuentoPct || '',
          codigo_promo: '',
          metodo: esManual ? 'transferencia' : 'wompi',
          cliente_nombre: clienteNombre.slice(0, 160),
          contacto: p.esExtra ? '' : contacto.slice(0, 200),
          objetivo_nombre: p.objNombre,
          objetivo_fecha_nac: p.objFecha,
          objetivo_foto: p.fotoFile ? p.fotoFile.filename : '',
          // El comprobante (uno por pedido) se guarda en el primer servicio.
          comprobante: (i === 0 && comprobanteFile) ? comprobanteFile.filename : '',
          info_extra: p.infoExtra,
          adelanto: p.esAdelanto ? 'solo' : (p.esExtra ? 'extra' : ''),
          estado: esManual ? 'pendiente_verificacion' : 'pendiente_pago',
          wompi_tx: '',
          correo_enviado: false,
          creado_en: creadoEn,
          pagado_en: '',
        };
        await db.crearAgendamiento(registro);
      }

      // NO se vacía el carrito aquí: el pedido aún no está pagado. Se vacía solo
      // cuando el pago queda confirmado (Wompi APROBADO en /pedido o aprobación
      // manual de la transferencia en el panel), para no perder el carrito si el
      // pago se rechaza o se abandona.

      res.json({
        ok: true,
        pedido_ref: pedidoRef,
        total_cop: totalCobro,
        signature: esManual ? '' : firmaIntegridadWompi(pedidoRef, totalCobro * 100, 'COP'),
      });
    } catch (e) {
      console.error('[checkout]', e);
      res.status(500).json({ ok: false, error: 'No se pudo procesar el pedido. Intenta de nuevo.' });
    }
  });
});

/* ---------- Regreso desde Wompi para un pedido: verifica y agenda todo ---------- */
app.get('/pedido/:pedidoRef', async function (req, res) {
  const pedidoRef = req.params.pedidoRef;
  let registros = await db.obtenerPorPedido(pedidoRef);
  if (!registros.length) {
    return res.status(404).send(templates.paginaGracias({ estado: 'no_encontrado' }));
  }

  const primero = registros[0];
  const totalPedido = parseInt(primero.pedido_total_cop, 10) || 0;
  const txId = req.query.id;
  let estado;
  if (primero.estado === 'agendado') estado = 'agendado';
  else if (primero.estado === 'pendiente_verificacion') estado = 'comprobante_recibido';
  else estado = 'verificando';

  if (txId && primero.estado === 'pendiente_pago') {
    try {
      const r = await confirmarPagoPedido(pedidoRef, txId);
      if (r.agendado || r.yaAgendado) estado = 'agendado';
      else if (r.rechazado) estado = 'rechazado';
    } catch (e) {
      console.error('[wompi] Falló la verificación del pedido:', e.message);
    }
  }

  registros = await db.obtenerPorPedido(pedidoRef);
  res.send(templates.paginaGraciasPedido({
    estado: estado,
    registros: registros,
    pedidoRef: pedidoRef,
    total: totalPedido,
    metodo: primero.metodo,
    whatsapp: CONTACTO_WHATSAPP,
  }));
});

/* ---------- Webhook de eventos de Wompi (confirmación asíncrona) ---------- */
// Wompi llama aquí cuando una transacción cambia de estado, aunque el cliente no
// regrese al sitio tras pagar (cierra la pestaña, pierde conexión, etc.). Así el
// pedido se agenda igual. La seguridad se garantiza reverificando la transacción
// contra la API de Wompi (servidor a servidor) antes de agendar cualquier cosa.
function firmaEventoValida(evento) {
  try {
    if (!WOMPI_EVENTS_SECRET) return false;
    const sig = (evento && evento.signature) || {};
    const props = sig.properties || [];
    let concat = '';
    props.forEach(function (ruta) {
      const val = String(ruta).split('.').reduce(function (obj, clave) {
        return (obj == null) ? undefined : obj[clave];
      }, evento.data);
      concat += (val == null ? '' : String(val));
    });
    concat += String(evento.timestamp) + WOMPI_EVENTS_SECRET;
    const hash = crypto.createHash('sha256').update(concat).digest('hex');
    return hash === String(sig.checksum || '').toLowerCase();
  } catch (e) {
    return false;
  }
}

app.post('/wompi/webhook', async function (req, res) {
  try {
    const evento = req.body || {};
    // Si hay secreto de eventos configurado, exige una firma válida.
    if (WOMPI_EVENTS_SECRET && !firmaEventoValida(evento)) {
      console.error('[wompi webhook] Firma de evento inválida');
      return res.status(401).json({ ok: false });
    }
    const tx = evento.data && evento.data.transaction;
    if (!tx || !tx.id) return res.status(200).json({ ok: true });

    const referencia = tx.reference || '';
    if (/^FRESA-PED-/.test(referencia)) {
      await confirmarPagoPedido(referencia, tx.id);
    } else if (referencia) {
      await confirmarPagoRef(referencia, tx.id);
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[wompi webhook]', e.message);
    // 500 → Wompi reintentará el evento más tarde.
    return res.status(500).json({ ok: false });
  }
});

/* ---------- Autenticación del panel ---------- */
function comparaSegura(entrada, esperado) {
  if (!esperado) return false;
  const a = Buffer.from(String(entrada || ''));
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch (e) { return false; }
}

// Devuelve el rol correspondiente a la contraseña, o null si no coincide.
function rolPorPassword(entrada) {
  if (comparaSegura(entrada, ADMIN_PASSWORD)) return 'admin';
  if (comparaSegura(entrada, ASSISTANT_PASSWORD)) return 'asistente';
  return null;
}

function requiereAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  return res.redirect('/admin');
}

// Solo el rol 'admin' puede pasar (asistentes bloqueados).
function soloAdmin(req, res, next) {
  if (req.session && req.session.admin && req.session.rol === 'admin') return next();
  return res.status(403).send('Solo el administrador puede realizar esta acción.');
}

function mismoOrigen(req, res, next) {
  const origen = req.get('origin') || req.get('referer') || '';
  const host = req.get('host') || '';
  try {
    if (origen && new URL(origen).host === host) return next();
  } catch (e) { /* origen inválido */ }
  return res.status(403).send('Solicitud no permitida.');
}

// Guarda el acceso en la auditoría y envía la alerta por correo en segundo plano
// (sin bloquear el inicio de sesión). Se llama en cada intento, correcto o no.
async function registrarYalertarAcceso(req, info) {
  const evento = {
    id: 'acc-' + Date.now() + '-' + Math.floor(Math.random() * 9999),
    usuario: (info.usuario || '').toString().slice(0, 120),
    rol: info.rol || '',
    exito: !!info.exito,
    ip: (req.ip || '').toString().slice(0, 60),
    agente: (req.get('user-agent') || '').toString().slice(0, 300),
    cuando: new Date().toISOString(),
  };
  try { await db.registrarAcceso(evento); } catch (e) { console.error('[auditoria]', e.message); }
  mailer.enviarAlertaLogin(evento).catch(function (e) {
    console.error('[mailer] Falló la alerta de inicio de sesión:', e.message);
  });
  return evento;
}

app.get('/admin', async function (req, res) {
  if (req.session && req.session.admin) {
    const listaAg = await db.listarAgendamientos();
    const registros = [];
    for (const r of listaAg) {
      registros.push(Object.assign({}, r, { cliente_email: await emailDelCliente(r) }));
    }
    const esAdmin = req.session.rol === 'admin';
    const promos = await db.listarPromos();
    const listaCod = await db.listarCodigos();
    const codigos = [];
    for (const c of listaCod) {
      codigos.push(Object.assign({}, c, { usos: await db.contarUsosCodigo(c.codigo) }));
    }
    const usuarios = esAdmin ? await db.listarUsuariosAdmin() : [];
    const accesos = esAdmin ? await db.listarAccesos(80) : [];
    return res.send(templates.adminDashboard({
      registros: registros,
      rol: req.session.rol || 'admin',
      baseUrl: baseUrlDe(req),
      hechizos: HECHIZOS.lista,
      promos: promos,
      codigos: codigos,
      usuario: req.session.usuario || '',
      usuarioId: req.session.usuario_id || '',
      usuarios: usuarios,
      accesos: accesos,
    }));
  }
  res.send(templates.adminLogin({ noConfig: !ADMIN_PASSWORD }));
});

app.post('/admin/login', mismoOrigen, async function (req, res) {
  if (!ADMIN_PASSWORD) {
    return res.status(500).send(templates.adminLogin({ noConfig: true }));
  }
  const cuerpo = req.body || {};
  const usuarioIngresado = String(cuerpo.usuario || '').trim().toLowerCase();
  const password = cuerpo.password;

  // 1) Usuario con nombre creado por el administrador (verificación con hash).
  if (usuarioIngresado) {
    const u = await db.obtenerUsuarioAdmin(usuarioIngresado);
    if (u && verificarPassword(password, u.salt, u.hash)) {
      req.session.admin = true;
      req.session.rol = u.rol;
      req.session.usuario = u.usuario;
      req.session.usuario_id = u.id;
      try { await db.actualizarUsuarioAdmin(u.id, { ultimo_acceso: new Date().toISOString() }); } catch (e) { /* no crítico */ }
      await registrarYalertarAcceso(req, { usuario: u.usuario, rol: u.rol, exito: true });
      return res.redirect('/admin');
    }
    await registrarYalertarAcceso(req, { usuario: usuarioIngresado, rol: '', exito: false });
    return res.status(401).send(templates.adminLogin({ error: 'Usuario o contraseña incorrectos.' }));
  }

  // 2) Compatibilidad: acceso solo con la contraseña de entorno (sin usuario).
  const rol = rolPorPassword(password);
  if (rol) {
    req.session.admin = true;
    req.session.rol = rol;
    req.session.usuario = rol === 'admin' ? 'administrador' : 'asistente';
    await registrarYalertarAcceso(req, { usuario: req.session.usuario, rol: rol, exito: true });
    return res.redirect('/admin');
  }
  await registrarYalertarAcceso(req, { usuario: '(contraseña directa)', rol: '', exito: false });
  res.status(401).send(templates.adminLogin({ error: 'Usuario o contraseña incorrectos.' }));
});

app.post('/admin/logout', mismoOrigen, function (req, res) {
  req.session.destroy(function () { res.redirect('/admin'); });
});

app.get('/admin/exportar/excel', requiereAdmin, async function (req, res) {
  try {
    const registros = await db.listarAgendamientos();
    const buf = exportar.generarExcel(registros);
    const nombre = 'fresatanika-agendamientos-' + new Date().toISOString().slice(0, 10) + '.xlsx';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="' + nombre + '"');
    res.send(buf);
  } catch (e) {
    console.error('[exportar/excel]', e);
    res.status(500).send('Error al generar el Excel.');
  }
});

app.get('/admin/exportar/pdf', requiereAdmin, async function (req, res) {
  try {
    const registros = await db.listarAgendamientos();
    const nombre = 'fresatanika-agendamientos-' + new Date().toISOString().slice(0, 10) + '.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + nombre + '"');
    exportar.generarPDF(registros, res);
  } catch (e) {
    console.error('[exportar/pdf]', e);
    res.status(500).send('Error al generar el PDF.');
  }
});

app.post('/admin/trabajo/:ref', mismoOrigen, requiereAdmin, async function (req, res) {
  const reg = await db.obtenerPorRef(req.params.ref);
  if (reg) {
    const hecho = !reg.trabajo_hecho;
    await db.actualizarPorRef(req.params.ref, {
      trabajo_hecho: hecho,
      trabajo_hecho_en: hecho ? new Date().toISOString() : '',
    });
    // Al marcar el trabajo como realizado, se avisa al cliente registrado.
    if (hecho) await notificarEstadoCliente(req.params.ref, 'realizado');
  }
  res.redirect('/admin');
});

app.post('/admin/aprobar/:ref', mismoOrigen, requiereAdmin, soloAdmin, async function (req, res) {
  const reg = await db.obtenerPorRef(req.params.ref);
  if (reg && reg.estado === 'pendiente_verificacion') {
    const pagadoEn = new Date().toISOString();
    if (reg.pedido_ref) {
      // Pedido de carrito: se aprueban todos los servicios del pedido a la vez.
      await db.actualizarPorPedido(reg.pedido_ref, { estado: 'agendado', pagado_en: pagadoEn });
      // Pago confirmado manualmente: recién ahora se vacía el carrito del cliente.
      if (reg.cliente_id) {
        try { await db.guardarCarritoCliente(reg.cliente_id, []); } catch (e) { /* noop */ }
      }
      if (!reg.correo_enviado) {
        try {
          const registros = await db.obtenerPorPedido(reg.pedido_ref);
          const total = parseInt(reg.pedido_total_cop, 10) || 0;
          const r = await mailer.enviarNotificacionPedido(registros, total);
          if (r.enviado) await db.actualizarPorPedido(reg.pedido_ref, { correo_enviado: true });
        } catch (e) {
          console.error('[mailer] Falló la notificación del pedido:', e.message);
        }
      }
      await notificarEstadoPedido(reg.pedido_ref, 'agendado');
    } else {
      const actualizado = await db.actualizarPorRef(req.params.ref, { estado: 'agendado', pagado_en: pagadoEn });
      if (actualizado && !actualizado.correo_enviado) {
        try {
          const r = await mailer.enviarNotificacion(actualizado);
          if (r.enviado) await db.actualizarPorRef(req.params.ref, { correo_enviado: true });
        } catch (e) {
          console.error('[mailer] Falló el envío de la notificación:', e.message);
        }
      }
      await notificarEstadoCliente(req.params.ref, 'agendado');
    }
  }
  res.redirect('/admin');
});

app.post('/admin/rechazar/:ref', mismoOrigen, requiereAdmin, soloAdmin, async function (req, res) {
  const reg = await db.obtenerPorRef(req.params.ref);
  if (reg && reg.estado === 'pendiente_verificacion') {
    if (reg.pedido_ref) {
      await db.actualizarPorPedido(reg.pedido_ref, { estado: 'rechazado' });
      await notificarEstadoPedido(reg.pedido_ref, 'rechazado');
    } else {
      await db.actualizarPorRef(req.params.ref, { estado: 'rechazado' });
      await notificarEstadoCliente(req.params.ref, 'rechazado');
    }
  }
  res.redirect('/admin');
});

app.post('/admin/eliminar/:ref', mismoOrigen, requiereAdmin, async function (req, res) {
  const reg = await db.obtenerPorRef(req.params.ref);
  // Las asistentes no pueden eliminar agendamientos ya marcados como realizados.
  if (reg && reg.trabajo_hecho && req.session.rol !== 'admin') {
    return res.status(403).send('Solo el administrador puede eliminar un agendamiento marcado como realizado.');
  }
  await db.eliminarPorRef(req.params.ref);
  res.redirect('/admin');
});

/* ---------- Edición de pedidos (solo administrador) ---------- */
const ESTADOS_VALIDOS = ['pendiente_pago', 'pendiente_verificacion', 'agendado', 'rechazado'];

// Recalcula el total de un pedido como la suma de los precios de sus servicios.
async function recalcularTotalPedido(pedidoRef) {
  if (!pedidoRef) return 0;
  const registros = await db.obtenerPorPedido(pedidoRef);
  const total = registros.reduce(function (s, r) { return s + (parseInt(r.precio_cop, 10) || 0); }, 0);
  await db.actualizarPorPedido(pedidoRef, { pedido_total_cop: total });
  return total;
}

// El administrador puede corregir el servicio, su precio y el estado de pago.
app.post('/admin/editar/:ref', mismoOrigen, requiereAdmin, soloAdmin, async function (req, res) {
  const reg = await db.obtenerPorRef(req.params.ref);
  if (!reg) return res.status(404).send('Agendamiento no encontrado.');
  const b = req.body || {};
  const cambios = {};

  const producto = (b.producto || '').toString().trim();
  if (producto) cambios.producto = producto.slice(0, 200);

  if (b.precio_cop !== undefined && String(b.precio_cop).trim() !== '') {
    const precio = parseInt(b.precio_cop, 10);
    if (!isNaN(precio) && precio >= 0) {
      cambios.precio_cop = precio;
      cambios.precio_texto = '$' + precio.toLocaleString('es-CO') + ' COP';
    }
  }

  const estado = (b.estado || '').toString().trim();
  if (estado && ESTADOS_VALIDOS.indexOf(estado) !== -1) cambios.estado = estado;

  await db.actualizarPorRef(req.params.ref, cambios);

  // Si el servicio pertenece a un pedido, se recalcula el total del pedido.
  if (reg.pedido_ref) await recalcularTotalPedido(reg.pedido_ref);

  res.redirect('/admin');
});

// Agrega un servicio a un agendamiento. Si era individual, lo convierte en un
// pedido para poder agrupar varios servicios bajo una misma referencia.
app.post('/admin/servicio/:ref', mismoOrigen, requiereAdmin, soloAdmin, async function (req, res) {
  const reg = await db.obtenerPorRef(req.params.ref);
  if (!reg) return res.status(404).send('Agendamiento no encontrado.');
  const b = req.body || {};
  const producto = (b.producto || '').toString().trim();
  const precio = parseInt(b.precio_cop, 10);
  if (!producto || isNaN(precio) || precio < 0) {
    return res.status(400).send('Datos del servicio incompletos.');
  }

  let pedidoRef = reg.pedido_ref;
  if (!pedidoRef) {
    pedidoRef = 'FRESA-PED-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex');
    await db.actualizarPorRef(reg.ref, { pedido_ref: pedidoRef });
  }

  const nuevoRef = 'FRESA-' + Date.now() + '-' + Math.floor(Math.random() * 9999);
  await db.crearAgendamiento({
    ref: nuevoRef,
    producto: producto.slice(0, 200),
    precio_cop: precio,
    precio_usd: 0,
    precio_texto: '$' + precio.toLocaleString('es-CO') + ' COP',
    precio_original: '',
    descuento_pct: '',
    codigo_promo: '',
    metodo: reg.metodo || 'transferencia',
    cliente_id: reg.cliente_id || '',
    cliente_nombre: reg.cliente_nombre || '',
    contacto: reg.contacto || '',
    objetivo_nombre: (b.objetivo_nombre || '').toString().trim().slice(0, 200),
    objetivo_fecha_nac: '',
    objetivo_foto: '',
    comprobante: '',
    info_extra: (b.info_extra || '').toString().trim().slice(0, 2000),
    adelanto: false,
    estado: reg.estado || 'agendado',
    wompi_tx: '',
    // Servicio agregado manualmente por el admin: sin correo de pago automático.
    correo_enviado: true,
    pedido_ref: pedidoRef,
    creado_en: new Date().toISOString(),
    pagado_en: reg.pagado_en || '',
  });
  await recalcularTotalPedido(pedidoRef);
  res.redirect('/admin');
});

/* ---------- Gestión de usuarios del panel (solo administrador) ---------- */
app.post('/admin/usuarios', mismoOrigen, requiereAdmin, soloAdmin, async function (req, res) {
  const b = req.body || {};
  const nombre = (b.nombre || '').toString().trim().slice(0, 120);
  const usuario = (b.usuario || '').toString().trim().toLowerCase();
  const password = (b.password || '').toString();
  const rol = b.rol === 'admin' ? 'admin' : 'asistente';

  if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) {
    return res.status(400).send('El usuario debe tener entre 3 y 30 caracteres: letras, números, punto, guion o guion bajo.');
  }
  if (password.length < 6) {
    return res.status(400).send('La contraseña debe tener al menos 6 caracteres.');
  }
  if (await db.obtenerUsuarioAdmin(usuario)) {
    return res.status(400).send('Ya existe un usuario con ese nombre.');
  }
  const cred = hashearPassword(password);
  await db.crearUsuarioAdmin({
    id: 'usr-' + Date.now() + '-' + Math.floor(Math.random() * 9999),
    usuario: usuario,
    nombre: nombre || usuario,
    rol: rol,
    salt: cred.salt,
    hash: cred.hash,
    creado_en: new Date().toISOString(),
    ultimo_acceso: '',
  });
  res.redirect('/admin');
});

app.post('/admin/usuarios/eliminar/:id', mismoOrigen, requiereAdmin, soloAdmin, async function (req, res) {
  // Un administrador no puede eliminar la propia cuenta con la que inició sesión.
  if (req.session.usuario_id && req.session.usuario_id === req.params.id) {
    return res.status(400).send('No puedes eliminar tu propia cuenta mientras la usas.');
  }
  await db.eliminarUsuarioAdmin(req.params.id);
  res.redirect('/admin');
});

/* ---------- Gestión de promociones (panel admin) ---------- */
function leerObjetivo(body) {
  // 'todos' o una lista de claves de hechizos.
  if ((body.objetivo_tipo || '') === 'especificos') {
    let claves = body.hechizos || [];
    if (!Array.isArray(claves)) claves = [claves];
    claves = claves.map(function (c) { return String(c).trim().toLowerCase(); })
      .filter(function (c) { return c && HECHIZOS.mapa[c]; });
    if (claves.length) return claves;
  }
  return 'todos';
}

app.post('/admin/promo', mismoOrigen, requiereAdmin, soloAdmin, async function (req, res) {
  const b = req.body || {};
  const pct = parseInt(b.porcentaje, 10);
  const desde = (b.desde || '').toString().trim();
  const hasta = (b.hasta || '').toString().trim();
  if (!pct || pct < 1 || pct > 100 || !desde || !hasta) {
    return res.status(400).send('Datos de la promoción incompletos.');
  }
  await db.crearPromo({
    id: 'promo-' + Date.now() + '-' + Math.floor(Math.random() * 9999),
    porcentaje: pct,
    desde: desde,
    hasta: hasta,
    objetivo: leerObjetivo(b),
    activa: true,
    creado_en: new Date().toISOString(),
  });
  res.redirect('/admin');
});

app.post('/admin/promo/eliminar/:id', mismoOrigen, requiereAdmin, soloAdmin, async function (req, res) {
  await db.eliminarPromo(req.params.id);
  res.redirect('/admin');
});

// Solo el administrador puede generar/eliminar códigos promocionales.
app.post('/admin/codigo', mismoOrigen, requiereAdmin, soloAdmin, async function (req, res) {
  const b = req.body || {};
  const codigo = (b.codigo || '').toString().trim();
  const pct = parseInt(b.porcentaje, 10);
  const desde = (b.desde || '').toString().trim();
  const hasta = (b.hasta || '').toString().trim();
  if (!codigo || !pct || pct < 1 || pct > 100 || !desde || !hasta) {
    return res.status(400).send('Datos del código incompletos.');
  }
  const limiteUsos = Math.max(0, parseInt(b.limite_usos, 10) || 0);
  await db.crearCodigo({
    id: 'cod-' + Date.now() + '-' + Math.floor(Math.random() * 9999),
    codigo: codigo,
    porcentaje: pct,
    desde: desde,
    hasta: hasta,
    objetivo: leerObjetivo(b),
    limite_usos: limiteUsos,
    activo: true,
    creado_en: new Date().toISOString(),
  });
  res.redirect('/admin');
});

app.post('/admin/codigo/eliminar/:id', mismoOrigen, requiereAdmin, soloAdmin, async function (req, res) {
  await db.eliminarCodigo(req.params.id);
  res.redirect('/admin');
});

app.get('/admin/foto/:nombre', requiereAdmin, function (req, res) {
  const nombre = path.basename(req.params.nombre);
  const ruta = path.join(db.UPLOADS_DIR, nombre);
  if (!ruta.startsWith(db.UPLOADS_DIR) || !fs.existsSync(ruta)) {
    return res.status(404).send('No encontrada');
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.sendFile(ruta);
});

/* ---------- Evidencia del trabajo ---------- */
// El administrador sube imágenes + notas de la evidencia y (si el cliente está
// registrado) se le envían por correo. Siempre queda un enlace público con token
// para poder compartirlo también por WhatsApp.
const subirEvidencia = upload.array('fotos', 10);
app.post('/admin/evidencia/:ref', mismoOrigen, requiereAdmin, soloAdmin, function (req, res) {
  subirEvidencia(req, res, async function (err) {
    if (err) {
      console.error('[evidencia] Error al subir:', err.message);
      return res.status(400).send('No se pudo subir la evidencia: ' + templates.escaparHtml(err.message));
    }
    try {
      const ref = req.params.ref;
      const reg = await db.obtenerPorRef(ref);
      if (!reg) return res.redirect('/admin');
      const nuevas = (req.files || []).map(function (f) { return f.filename; });
      const fotos = (Array.isArray(reg.evidencia_fotos) ? reg.evidencia_fotos : []).concat(nuevas);
      const notas = ((req.body && req.body.notas) || '').toString().trim().slice(0, 2000);
      const token = reg.evidencia_token || crypto.randomBytes(16).toString('hex');
      const actualizado = await db.actualizarPorRef(ref, {
        evidencia_fotos: fotos,
        evidencia_notas: notas,
        evidencia_en: new Date().toISOString(),
        evidencia_token: token,
      });
      const to = await emailDelCliente(actualizado);
      if (to) {
        try {
          const rutasNuevas = nuevas.map(function (n) { return path.join(db.UPLOADS_DIR, n); });
          await mailer.enviarEvidenciaCliente(actualizado, to, rutasNuevas, baseUrlDe(req));
        } catch (e) {
          console.error('[mailer] Falló el envío de la evidencia:', e.message);
        }
      }
      res.redirect('/admin');
    } catch (e) {
      console.error('[evidencia]', e);
      res.status(500).send('No se pudo guardar la evidencia.');
    }
  });
});

// Página pública de la evidencia (protegida por un token en la URL).
app.get('/evidencia/:ref/:token', async function (req, res) {
  const reg = await db.obtenerPorRef(req.params.ref);
  if (!reg || !reg.evidencia_token || reg.evidencia_token !== req.params.token) {
    return res.status(404).send('Evidencia no encontrada.');
  }
  res.send(templates.paginaEvidencia(reg, baseUrlDe(req)));
});

// Imagen de evidencia servida públicamente solo con el token correcto.
app.get('/evidencia-foto/:ref/:token/:nombre', async function (req, res) {
  const reg = await db.obtenerPorRef(req.params.ref);
  if (!reg || !reg.evidencia_token || reg.evidencia_token !== req.params.token) {
    return res.status(404).send('No encontrada');
  }
  const nombre = path.basename(req.params.nombre);
  if (!Array.isArray(reg.evidencia_fotos) || reg.evidencia_fotos.indexOf(nombre) === -1) {
    return res.status(404).send('No encontrada');
  }
  const ruta = path.join(db.UPLOADS_DIR, nombre);
  if (!ruta.startsWith(db.UPLOADS_DIR) || !fs.existsSync(ruta)) {
    return res.status(404).send('No encontrada');
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.sendFile(ruta);
});

/* ---------- Salud del servicio (para CapRover / balanceador) ---------- */
// Comprueba que la conexión a PostgreSQL responde. Se usa en el health check
// del contenedor para las actualizaciones sin downtime (rolling update).
app.get('/healthz', async function (req, res) {
  try {
    await db.verificarConexion();
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[healthz]', e.message);
    res.status(503).json({ ok: false });
  }
});

/* ---------- Sitio estático ---------- */
// En desarrollo se desactiva la caché para que los cambios en HTML/CSS/JS se vean
// de inmediato (en producción se conserva la caché normal por rendimiento).
if (process.env.NODE_ENV !== 'production') {
  app.use(function (req, res, next) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  });
}
app.use('/assets', express.static(path.join(ROOT, 'assets')));
app.get('/', function (req, res) {
  res.sendFile(path.join(ROOT, 'index.html'));
});

app.use(function (req, res) {
  res.status(404).sendFile(path.join(ROOT, 'index.html'));
});

/* ---------- Reconciliación de pagos Wompi "huérfanos" ---------- */
// Un pago puede quedar en pendiente_pago sin agendarse si el cliente cerró la
// pestaña antes de volver a /gracias o /pedido, o si el webhook de Wompi no
// llegó (caída de red, endpoint no configurado en el dashboard, etc.). Este
// job busca esos pendientes por REFERENCIA en la API de Wompi (sin depender de
// un id de transacción que nunca se guardó) y los agenda si ya fueron
// aprobados. Corre periódicamente y también justo antes de la limpieza por
// antigüedad, para no borrar jamás un pedido que en realidad sí fue pagado.
let reconciliacionEnCurso = false;
async function reconciliarPagosPendientes() {
  if (reconciliacionEnCurso) return;
  reconciliacionEnCurso = true;
  try {
    const pendientes = await db.listarPendientesPagoWompi();
    const pedidosVistos = {};
    let agendados = 0;
    for (const reg of pendientes) {
      try {
        if (reg.pedido_ref) {
          if (pedidosVistos[reg.pedido_ref]) continue;
          pedidosVistos[reg.pedido_ref] = true;
          const txs = await buscarTransaccionesPorReferencia(reg.pedido_ref);
          const aprobada = txs.find(function (t) { return t.status === 'APPROVED'; });
          if (aprobada) {
            const r = await confirmarPagoPedido(reg.pedido_ref, aprobada.id);
            if (r.agendado) agendados++;
          }
        } else {
          const txs = await buscarTransaccionesPorReferencia(reg.ref);
          const aprobada = txs.find(function (t) { return t.status === 'APPROVED'; });
          if (aprobada) {
            const r = await confirmarPagoRef(reg.ref, aprobada.id);
            if (r.agendado) agendados++;
          }
        }
      } catch (e) {
        console.error('[reconciliacion]', reg.ref, e.message);
      }
    }
    if (agendados > 0) console.log('[reconciliacion] ' + agendados + ' pago(s) recuperado(s) y agendado(s).');
  } catch (e) {
    console.error('[reconciliacion]', e.message);
  } finally {
    reconciliacionEnCurso = false;
  }
}

/* ---------- Limpieza automática de agendamientos sin pago (>48h) ---------- */
async function limpiarPendientes() {
  try {
    // Reconcilia primero: nunca se debe borrar un pedido que Wompi ya aprobó.
    await reconciliarPagosPendientes();
    const n = await db.eliminarPendientesAntiguos(48);
    if (n > 0) console.log('[limpieza] ' + n + ' agendamiento(s) sin pago eliminados (>48h).');
  } catch (e) {
    console.error('[limpieza]', e.message);
  }
}

/* ---------- Recordatorios de seguimiento (5 semanas y 4 meses) ---------- */
function sumarSemanas(iso, semanas) {
  return new Date(iso).getTime() + semanas * 7 * 24 * 60 * 60 * 1000;
}
function sumarMeses(iso, meses) {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + meses);
  return d.getTime();
}

let seguimientoEnCurso = false;
async function procesarSeguimientos() {
  if (seguimientoEnCurso) return;
  seguimientoEnCurso = true;
  try {
    const ahora = Date.now();
    const registros = await db.listarAgendamientos();
    for (const reg of registros) {
      if (!reg.trabajo_hecho || !reg.trabajo_hecho_en) continue;
      const base = new Date(reg.trabajo_hecho_en).getTime();
      if (!base) continue;

      if (!reg.seguimiento_5s_en && ahora >= sumarSemanas(reg.trabajo_hecho_en, 5)) {
        try {
          const r = await mailer.enviarSeguimiento(reg, '5semanas');
          if (r.enviado) await db.actualizarPorRef(reg.ref, { seguimiento_5s_en: new Date().toISOString() });
        } catch (e) {
          console.error('[seguimiento 5s]', reg.ref, e.message);
        }
      }

      if (!reg.seguimiento_4m_en && ahora >= sumarMeses(reg.trabajo_hecho_en, 4)) {
        try {
          const r = await mailer.enviarSeguimiento(reg, '4meses');
          if (r.enviado) await db.actualizarPorRef(reg.ref, { seguimiento_4m_en: new Date().toISOString() });
        } catch (e) {
          console.error('[seguimiento 4m]', reg.ref, e.message);
        }
      }
    }
  } catch (e) {
    console.error('[seguimiento]', e.message);
  } finally {
    seguimientoEnCurso = false;
  }
}

// Referencias que se limpian durante el apagado ordenado (graceful shutdown).
let servidor = null;
let intervaloLimpieza = null;
let intervaloSeguimientos = null;
let intervaloReconciliacion = null;
let apagando = false;
// Promesas de las tareas en segundo plano en curso; el apagado las espera para
// no cortar una escritura a PostgreSQL a mitad de camino.
let tareaLimpieza = Promise.resolve();
let tareaSeguimientos = Promise.resolve();
let tareaReconciliacion = Promise.resolve();

function lanzarLimpieza() {
  tareaLimpieza = limpiarPendientes().catch(function (e) { console.error('[limpieza]', e.message); });
  return tareaLimpieza;
}
function lanzarSeguimientos() {
  tareaSeguimientos = procesarSeguimientos().catch(function (e) { console.error('[seguimiento]', e.message); });
  return tareaSeguimientos;
}
function lanzarReconciliacion() {
  tareaReconciliacion = reconciliarPagosPendientes().catch(function (e) { console.error('[reconciliacion]', e.message); });
  return tareaReconciliacion;
}

async function iniciar() {
  // 1) Prepara el esquema en PostgreSQL y migra los datos del JSON solo si las
  //    tablas están vacías (idempotente: no duplica ni sobrescribe nada).
  await db.init();

  // 2) Levanta el servidor HTTP.
  servidor = app.listen(PORT, '0.0.0.0', function () {
    console.log('Fresatanika escuchando en el puerto ' + PORT);
    console.log('Datos en: ' + db.DATA_DIR);
    if (!process.env.SMTP_PASS) console.warn('Aviso: SMTP_PASS no está configurado; las notificaciones por correo están desactivadas.');
    lanzarLimpieza();
    intervaloLimpieza = setInterval(lanzarLimpieza, 60 * 60 * 1000);
    lanzarSeguimientos();
    intervaloSeguimientos = setInterval(lanzarSeguimientos, 6 * 60 * 60 * 1000);
    // Reconciliación de pagos Wompi cada 15 minutos: agenda cualquier pago
    // aprobado que se haya quedado sin confirmar por el regreso web o el
    // webhook, mucho antes de que la limpieza de 48h pudiera borrarlo.
    lanzarReconciliacion();
    intervaloReconciliacion = setInterval(lanzarReconciliacion, 15 * 60 * 1000);
  });
}

// Apagado ordenado: deja de aceptar conexiones nuevas, termina las tareas
// programadas y cierra el pool de PostgreSQL. Permite actualizaciones sin
// downtime (rolling update) con varias instancias detrás del balanceador.
async function apagar(senal) {
  if (apagando) return;
  apagando = true;
  console.log('[apagado] Señal ' + senal + ' recibida; cerrando ordenadamente...');
  if (intervaloLimpieza) clearInterval(intervaloLimpieza);
  if (intervaloSeguimientos) clearInterval(intervaloSeguimientos);
  if (intervaloReconciliacion) clearInterval(intervaloReconciliacion);

  const cerrarHttp = new Promise(function (resolve) {
    if (!servidor) return resolve();
    servidor.close(function () { resolve(); });
  });
  // Si algo se queda colgado, se fuerza la salida a los 10 s.
  const limite = setTimeout(function () {
    console.error('[apagado] Tiempo de espera agotado; salida forzada.');
    process.exit(1);
  }, 10000);
  limite.unref();

  try {
    await cerrarHttp;
    // Espera a que terminen las tareas en segundo plano ya en curso antes de
    // cerrar el pool, para no cortar una escritura a mitad.
    await Promise.allSettled([tareaLimpieza, tareaSeguimientos, tareaReconciliacion]);
    await db.cerrar();
    console.log('[apagado] Cierre completo.');
    clearTimeout(limite);
    process.exit(0);
  } catch (e) {
    console.error('[apagado]', e.message);
    process.exit(1);
  }
}

process.on('SIGTERM', function () { apagar('SIGTERM'); });
process.on('SIGINT', function () { apagar('SIGINT'); });

iniciar().catch(function (e) {
  console.error('[inicio] No se pudo arrancar el servidor:', e);
  process.exit(1);
});
