'use strict';

const express = require('express');
const session = require('express-session');
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

// Firma de integridad Wompi = SHA256(referencia + montoEnCentavos + moneda + secreto).
function firmaIntegridadWompi(referencia, montoCentavos, moneda) {
  if (!WOMPI_INTEGRITY_SECRET) return '';
  const cadena = String(referencia) + String(montoCentavos) + String(moneda) + WOMPI_INTEGRITY_SECRET;
  return crypto.createHash('sha256').update(cadena).digest('hex');
}

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
function descuentoFechaPara(clave) {
  const hoy = hoyBogota();
  let mejor = 0;
  db.listarPromos().forEach(function (p) {
    if (p.activa === false) return;
    if (!enVentana(p.desde, p.hasta, hoy)) return;
    if (!objetivoIncluye(p.objetivo, clave)) return;
    const pct = Number(p.porcentaje) || 0;
    if (pct > mejor) mejor = pct;
  });
  return mejor;
}

// Valida un código para un hechizo y devuelve su porcentaje (0 si no aplica).
function codigoDescuentoPara(clave, codigoStr) {
  const cod = String(codigoStr || '').trim().toLowerCase();
  if (!cod) return { pct: 0, valido: false, codigo: '' };
  const hoy = hoyBogota();
  let encontrado = null;
  db.listarCodigos().forEach(function (c) {
    if (String(c.codigo || '').trim().toLowerCase() !== cod) return;
    if (c.activo === false) return;
    if (!enVentana(c.desde, c.hasta, hoy)) return;
    if (!objetivoIncluye(c.objetivo, clave)) return;
    encontrado = c;
  });
  if (!encontrado) return { pct: 0, valido: false, codigo: '' };
  return { pct: Number(encontrado.porcentaje) || 0, valido: true, codigo: encontrado.codigo };
}

// Calcula el mejor descuento aplicable a un hechizo (no se acumulan: se toma el mayor).
// `base` es el precio base validado (algunos hechizos comparten nombre con precios
// distintos, por eso se usa el precio base recibido y no un mapa fijo).
function calcularDescuentoHechizo(clave, codigoStr, base) {
  const h = HECHIZOS.mapa[clave];
  if (!h) return null;
  // El precio base debe corresponder realmente a este hechizo; así se evita
  // que un servicio que no es hechizo obtenga descuento enviando una clave válida.
  if (Array.isArray(h.precios) && h.precios.indexOf(base) === -1) return null;
  const pctFecha = descuentoFechaPara(clave);
  const cod = codigoDescuentoPara(clave, codigoStr);
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

/* ---------- Secreto de sesión (env o persistido en el volumen de datos) ---------- */
function obtenerSecretoSesion() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const archivo = path.join(db.DATA_DIR, '.session_secret');
  try {
    return fs.readFileSync(archivo, 'utf8');
  } catch (e) {
    const secreto = crypto.randomBytes(32).toString('hex');
    try { fs.writeFileSync(archivo, secreto); } catch (err) { /* noop */ }
    return secreto;
  }
}

app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(session({
  name: 'fresa.sid',
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
async function verificarTransaccionWompi(txId) {
  const base = WOMPI_PUBLIC_KEY.indexOf('pub_prod') === 0
    ? 'https://production.wompi.co/v1'
    : 'https://sandbox.wompi.co/v1';
  const resp = await fetch(base + '/transactions/' + encodeURIComponent(txId));
  if (!resp.ok) return null;
  const json = await resp.json();
  return json && json.data ? json.data : null;
}

/* ---------- Config pública para el frontend ---------- */
app.get('/api/config', function (req, res) {
  res.json({
    wompiPublicKey: WOMPI_PUBLIC_KEY,
    comision: { pct: WOMPI_COM_PCT, fijo: WOMPI_COM_FIJO, iva: WOMPI_IVA },
  });
});

/* ---------- Promociones activas por fecha (para mostrar precios rebajados) ---------- */
app.get('/api/promociones', function (req, res) {
  const descuentos = {};
  HECHIZOS.lista.forEach(function (h) {
    const pct = descuentoFechaPara(h.clave);
    if (pct > 0) descuentos[h.clave] = pct;
  });
  res.json({ descuentos: descuentos });
});

/* ---------- Validar un código promocional para un hechizo ---------- */
app.post('/api/codigo', function (req, res) {
  const b = req.body || {};
  const clave = (b.hechizo_clave || '').toString().trim().toLowerCase();
  const codigo = (b.codigo || '').toString().trim();
  if (!clave || !HECHIZOS.mapa[clave]) {
    return res.status(400).json({ ok: false, error: 'Los códigos solo aplican a los hechizos.' });
  }
  const cod = codigoDescuentoPara(clave, codigo);
  if (!cod.valido || cod.pct <= 0) {
    return res.status(400).json({ ok: false, error: 'El código no es válido o no aplica a este hechizo.' });
  }
  res.json({ ok: true, porcentaje: cod.pct });
});

/* ---------- Registrar agendamiento (antes de pagar) ---------- */
const subirArchivos = upload.fields([
  { name: 'objetivo_foto', maxCount: 1 },
  { name: 'comprobante', maxCount: 1 },
]);

app.post('/api/booking', function (req, res) {
  subirArchivos(req, res, function (err) {
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
      // El pago en dólares nunca pasa por Wompi (solo cobra COP): se paga por
      // PayPal/AstroPay y se verifica manualmente, igual que una transferencia.
      const esManual = esTransferencia || moneda === 'usd';

      // Falla en seguro: sin el secreto de integridad, Wompi rechazaría el pago.
      // Evitamos crear un agendamiento y redirigir a un checkout que dará error.
      if (!esManual && !WOMPI_INTEGRITY_SECRET) {
        console.error('[booking] WOMPI_INTEGRITY_SECRET no configurado');
        return res.status(503).json({ error: 'El pago con tarjeta no está disponible por ahora. Intenta con transferencia o escríbenos.' });
      }

      // --- Pago de adelanto (urgencia) suelto: formulario corto ---
      // Solo se piden el nombre del cliente y el/los trabajos para los que se paga.
      if ((b.adelanto || '').toString().trim() === 'solo') {
        const trabajos = (b.info_extra || '').toString().trim();
        if (!trabajos) return res.status(400).json({ error: 'Escribe para cuál(es) trabajo(s) es el adelanto.' });
        if (esManual && !comprobanteFile) {
          return res.status(400).json({ error: 'Sube el comprobante de tu pago.' });
        }
        let totalCopA, precioTextoA;
        if (moneda === 'usd') {
          // Pago en dólares: por PayPal/AstroPay, sin conversión ni comisión.
          totalCopA = 0;
          precioTextoA = '$' + ADELANTO_USD + ' USD';
        } else {
          totalCopA = !esTransferencia ? conComisionWompi(ADELANTO_COP) : ADELANTO_COP;
          precioTextoA = '$' + ADELANTO_COP.toLocaleString('es-CO') + ' COP' +
            (!esTransferencia ? ' · Total $' + totalCopA.toLocaleString('es-CO') + ' COP (incluye comisión Wompi)' : '');
        }
        const refA = 'FRESA-' + Date.now() + '-' + Math.floor(Math.random() * 9999);
        const registroA = {
          ref: refA,
          producto: 'Adelanto (urgencia)',
          precio_cop: totalCopA,
          precio_usd: ADELANTO_USD,
          precio_texto: precioTextoA,
          precio_original: '',
          descuento_pct: '',
          codigo_promo: '',
          metodo: esManual ? 'transferencia' : 'wompi',
          cliente_nombre: clienteNombre.slice(0, 160),
          contacto: '',
          objetivo_nombre: '',
          objetivo_fecha_nac: '',
          objetivo_foto: '',
          comprobante: comprobanteFile ? comprobanteFile.filename : '',
          info_extra: trabajos.slice(0, 2000),
          adelanto: 'solo',
          estado: esManual ? 'pendiente_verificacion' : 'pendiente_pago',
          wompi_tx: '',
          correo_enviado: false,
          creado_en: new Date().toISOString(),
          pagado_en: '',
        };
        db.crearAgendamiento(registroA);
        return res.json({
          ok: true, ref: refA, precio_cop: totalCopA, precio_texto: registroA.precio_texto,
          signature: esManual ? '' : firmaIntegridadWompi(refA, totalCopA * 100, 'COP'),
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
      const info = claveEnviada ? calcularDescuentoHechizo(claveEnviada, codigoEnviado, base) : null;

      // El USD es solo informativo (Wompi cobra en COP); se recalcula en paralelo
      // al COP para que el descuento y el adelanto también se reflejen en dólares.
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

      if (moneda === 'usd') {
        if (isNaN(usdBase)) {
          return res.status(400).json({ error: 'Este servicio no tiene precio en dólares. Paga en pesos (COP).' });
        }
        // El precio en dólares debe corresponder a un servicio real del catálogo.
        if (USD_VALIDOS.size && !USD_VALIDOS.has(Math.round(usdBase * 100) / 100)) {
          return res.status(400).json({ error: 'El precio en dólares no corresponde a ningún servicio del catálogo.' });
        }
      }
      let totalCop, precioTextoFinal;
      if (moneda === 'usd') {
        // Pago en dólares: por PayPal/AstroPay, sin conversión ni comisión.
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
      db.crearAgendamiento(registro);
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
  const registro = db.obtenerPorRef(ref);
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
      const tx = await verificarTransaccionWompi(txId);
      const montoOk = tx && Number(tx.amount_in_cents) === registro.precio_cop * 100;
      const monedaOk = tx && tx.currency === 'COP';
      const refOk = tx && tx.reference === ref;
      if (tx && tx.status === 'APPROVED' && refOk && montoOk && monedaOk) {
        const actualizado = db.actualizarPorRef(ref, {
          estado: 'agendado',
          wompi_tx: txId,
          pagado_en: new Date().toISOString(),
        });
        estado = 'agendado';
        if (!registro.correo_enviado) {
          try {
            const r = await mailer.enviarNotificacion(actualizado);
            if (r.enviado) db.actualizarPorRef(ref, { correo_enviado: true });
          } catch (e) {
            console.error('[mailer] Falló el envío de la notificación:', e.message);
          }
        }
      } else if (tx && ['DECLINED', 'ERROR', 'VOIDED'].indexOf(tx.status) !== -1) {
        estado = 'rechazado';
      }
    } catch (e) {
      console.error('[wompi] Falló la verificación:', e.message);
    }
  }

  const regActual = db.obtenerPorRef(ref) || registro;
  res.send(templates.paginaGracias({ estado: estado, reg: regActual }));
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

app.get('/admin', function (req, res) {
  if (req.session && req.session.admin) {
    return res.send(templates.adminDashboard({
      registros: db.listarAgendamientos(),
      rol: req.session.rol || 'admin',
      hechizos: HECHIZOS.lista,
      promos: db.listarPromos(),
      codigos: db.listarCodigos(),
    }));
  }
  res.send(templates.adminLogin({ noConfig: !ADMIN_PASSWORD }));
});

app.post('/admin/login', mismoOrigen, function (req, res) {
  if (!ADMIN_PASSWORD) {
    return res.status(500).send(templates.adminLogin({ noConfig: true }));
  }
  const rol = rolPorPassword((req.body || {}).password);
  if (rol) {
    req.session.admin = true;
    req.session.rol = rol;
    return res.redirect('/admin');
  }
  res.status(401).send(templates.adminLogin({ error: 'Contraseña incorrecta.' }));
});

app.post('/admin/logout', mismoOrigen, function (req, res) {
  req.session.destroy(function () { res.redirect('/admin'); });
});

app.get('/admin/exportar/excel', requiereAdmin, function (req, res) {
  try {
    const registros = db.listarAgendamientos();
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

app.get('/admin/exportar/pdf', requiereAdmin, function (req, res) {
  try {
    const registros = db.listarAgendamientos();
    const nombre = 'fresatanika-agendamientos-' + new Date().toISOString().slice(0, 10) + '.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + nombre + '"');
    exportar.generarPDF(registros, res);
  } catch (e) {
    console.error('[exportar/pdf]', e);
    res.status(500).send('Error al generar el PDF.');
  }
});

app.post('/admin/trabajo/:ref', mismoOrigen, requiereAdmin, function (req, res) {
  const reg = db.obtenerPorRef(req.params.ref);
  if (reg) {
    const hecho = !reg.trabajo_hecho;
    db.actualizarPorRef(req.params.ref, {
      trabajo_hecho: hecho,
      trabajo_hecho_en: hecho ? new Date().toISOString() : '',
    });
  }
  res.redirect('/admin');
});

app.post('/admin/aprobar/:ref', mismoOrigen, requiereAdmin, async function (req, res) {
  const reg = db.obtenerPorRef(req.params.ref);
  if (reg && reg.estado === 'pendiente_verificacion') {
    const actualizado = db.actualizarPorRef(req.params.ref, {
      estado: 'agendado',
      pagado_en: new Date().toISOString(),
    });
    if (actualizado && !actualizado.correo_enviado) {
      try {
        const r = await mailer.enviarNotificacion(actualizado);
        if (r.enviado) db.actualizarPorRef(req.params.ref, { correo_enviado: true });
      } catch (e) {
        console.error('[mailer] Falló el envío de la notificación:', e.message);
      }
    }
  }
  res.redirect('/admin');
});

app.post('/admin/rechazar/:ref', mismoOrigen, requiereAdmin, function (req, res) {
  const reg = db.obtenerPorRef(req.params.ref);
  if (reg && reg.estado === 'pendiente_verificacion') {
    db.actualizarPorRef(req.params.ref, { estado: 'rechazado' });
  }
  res.redirect('/admin');
});

app.post('/admin/eliminar/:ref', mismoOrigen, requiereAdmin, function (req, res) {
  const reg = db.obtenerPorRef(req.params.ref);
  // Las asistentes no pueden eliminar agendamientos ya marcados como realizados.
  if (reg && reg.trabajo_hecho && req.session.rol !== 'admin') {
    return res.status(403).send('Solo el administrador puede eliminar un agendamiento marcado como realizado.');
  }
  db.eliminarPorRef(req.params.ref);
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

app.post('/admin/promo', mismoOrigen, requiereAdmin, soloAdmin, function (req, res) {
  const b = req.body || {};
  const pct = parseInt(b.porcentaje, 10);
  const desde = (b.desde || '').toString().trim();
  const hasta = (b.hasta || '').toString().trim();
  if (!pct || pct < 1 || pct > 100 || !desde || !hasta) {
    return res.status(400).send('Datos de la promoción incompletos.');
  }
  db.crearPromo({
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

app.post('/admin/promo/eliminar/:id', mismoOrigen, requiereAdmin, soloAdmin, function (req, res) {
  db.eliminarPromo(req.params.id);
  res.redirect('/admin');
});

// Solo el administrador puede generar/eliminar códigos promocionales.
app.post('/admin/codigo', mismoOrigen, requiereAdmin, soloAdmin, function (req, res) {
  const b = req.body || {};
  const codigo = (b.codigo || '').toString().trim();
  const pct = parseInt(b.porcentaje, 10);
  const desde = (b.desde || '').toString().trim();
  const hasta = (b.hasta || '').toString().trim();
  if (!codigo || !pct || pct < 1 || pct > 100 || !desde || !hasta) {
    return res.status(400).send('Datos del código incompletos.');
  }
  db.crearCodigo({
    id: 'cod-' + Date.now() + '-' + Math.floor(Math.random() * 9999),
    codigo: codigo,
    porcentaje: pct,
    desde: desde,
    hasta: hasta,
    objetivo: leerObjetivo(b),
    activo: true,
    creado_en: new Date().toISOString(),
  });
  res.redirect('/admin');
});

app.post('/admin/codigo/eliminar/:id', mismoOrigen, requiereAdmin, soloAdmin, function (req, res) {
  db.eliminarCodigo(req.params.id);
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

/* ---------- Sitio estático ---------- */
app.use('/assets', express.static(path.join(ROOT, 'assets')));
app.get('/', function (req, res) {
  res.sendFile(path.join(ROOT, 'index.html'));
});

app.use(function (req, res) {
  res.status(404).sendFile(path.join(ROOT, 'index.html'));
});

/* ---------- Limpieza automática de agendamientos sin pago (>48h) ---------- */
function limpiarPendientes() {
  try {
    const n = db.eliminarPendientesAntiguos(48);
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
    const registros = db.listarAgendamientos();
    for (const reg of registros) {
      if (!reg.trabajo_hecho || !reg.trabajo_hecho_en) continue;
      const base = new Date(reg.trabajo_hecho_en).getTime();
      if (!base) continue;

      if (!reg.seguimiento_5s_en && ahora >= sumarSemanas(reg.trabajo_hecho_en, 5)) {
        try {
          const r = await mailer.enviarSeguimiento(reg, '5semanas');
          if (r.enviado) db.actualizarPorRef(reg.ref, { seguimiento_5s_en: new Date().toISOString() });
        } catch (e) {
          console.error('[seguimiento 5s]', reg.ref, e.message);
        }
      }

      if (!reg.seguimiento_4m_en && ahora >= sumarMeses(reg.trabajo_hecho_en, 4)) {
        try {
          const r = await mailer.enviarSeguimiento(reg, '4meses');
          if (r.enviado) db.actualizarPorRef(reg.ref, { seguimiento_4m_en: new Date().toISOString() });
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

app.listen(PORT, '0.0.0.0', function () {
  console.log('Fresatanika escuchando en el puerto ' + PORT);
  console.log('Datos en: ' + db.DATA_DIR);
  if (!process.env.SMTP_PASS) console.warn('Aviso: SMTP_PASS no está configurado; las notificaciones por correo están desactivadas.');
  limpiarPendientes();
  setInterval(limpiarPendientes, 60 * 60 * 1000);
  procesarSeguimientos();
  setInterval(procesarSeguimientos, 6 * 60 * 60 * 1000);
});
