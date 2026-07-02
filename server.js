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
const WOMPI_PUBLIC_KEY = process.env.WOMPI_PUBLIC_KEY || 'pub_test_gjhaZFqRwKaZMBcAEBYOjYNGqzGUyPXx';

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
  res.json({ wompiPublicKey: WOMPI_PUBLIC_KEY });
});

/* ---------- Registrar agendamiento (antes de pagar) ---------- */
app.post('/api/booking', function (req, res) {
  upload.single('objetivo_foto')(req, res, function (err) {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'La foto es demasiado grande (máximo 8 MB).'
        : (err.message || 'No se pudo subir la foto.');
      return res.status(400).json({ error: msg });
    }
    try {
      const b = req.body || {};
      const clienteNombre = (b.cliente_nombre || '').toString().trim();
      if (!clienteNombre) return res.status(400).json({ error: 'Escribe tu nombre y apellido.' });

      const contacto = (b.contacto || '').toString().trim();
      if (!contacto) return res.status(400).json({ error: 'Escribe tu WhatsApp o red social para entregarte la evidencia.' });

      const precio = parseInt(b.precio_cop, 10);
      if (!precio || precio < 1000) return res.status(400).json({ error: 'El precio no es válido.' });
      if (PRECIOS_VALIDOS.size && !PRECIOS_VALIDOS.has(precio)) {
        return res.status(400).json({ error: 'El precio no corresponde a ningún servicio del catálogo.' });
      }

      const objNombre = (b.objetivo_nombre || '').toString().trim();
      const objFecha = (b.objetivo_fecha_nac || '').toString().trim();
      const tieneFoto = !!req.file;
      if (!objNombre && !objFecha && !tieneFoto) {
        return res.status(400).json({ error: 'Proporciona el nombre o la fecha de nacimiento de la persona, o sube una foto.' });
      }

      const ref = 'FRESA-' + Date.now() + '-' + Math.floor(Math.random() * 9999);
      const registro = {
        ref: ref,
        producto: (b.producto || '').toString().slice(0, 200),
        precio_cop: precio,
        precio_texto: (b.precio_texto || ('$' + precio + ' COP')).toString().slice(0, 60),
        cliente_nombre: clienteNombre.slice(0, 160),
        contacto: contacto.slice(0, 200),
        objetivo_nombre: objNombre.slice(0, 200),
        objetivo_fecha_nac: objFecha.slice(0, 40),
        objetivo_foto: req.file ? req.file.filename : '',
        info_extra: (b.info_extra || '').toString().trim().slice(0, 2000),
        estado: 'pendiente_pago',
        wompi_tx: '',
        correo_enviado: false,
        creado_en: new Date().toISOString(),
        pagado_en: '',
      };
      db.crearAgendamiento(registro);
      res.json({ ok: true, ref: ref });
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
  let estado = registro.estado === 'agendado' ? 'agendado' : 'verificando';

  if (txId && registro.estado !== 'agendado') {
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
function passwordValida(entrada) {
  const a = Buffer.from(String(entrada || ''));
  const b = Buffer.from(ADMIN_PASSWORD);
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch (e) { return false; }
}

function requiereAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  return res.redirect('/admin');
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
    return res.send(templates.adminDashboard({ registros: db.listarAgendamientos() }));
  }
  res.send(templates.adminLogin({ noConfig: !ADMIN_PASSWORD }));
});

app.post('/admin/login', mismoOrigen, function (req, res) {
  if (!ADMIN_PASSWORD) {
    return res.status(500).send(templates.adminLogin({ noConfig: true }));
  }
  if (passwordValida((req.body || {}).password)) {
    req.session.admin = true;
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

app.post('/admin/eliminar/:ref', mismoOrigen, requiereAdmin, function (req, res) {
  db.eliminarPorRef(req.params.ref);
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

app.listen(PORT, '0.0.0.0', function () {
  console.log('Fresatanika escuchando en el puerto ' + PORT);
  console.log('Datos en: ' + db.DATA_DIR);
  if (!process.env.SMTP_PASS) console.warn('Aviso: SMTP_PASS no está configurado; las notificaciones por correo están desactivadas.');
  limpiarPendientes();
  setInterval(limpiarPendientes, 60 * 60 * 1000);
});
