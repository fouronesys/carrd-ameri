'use strict';

const nodemailer = require('nodemailer');
const templates = require('./templates');
const { seleccionarDestinatarios } = require('./notificaciones');

async function enviarInterno(contenido, tipo = 'operativo') {
  const c = obtenerConfig();
  const transport = crearTransport();
  if (!transport) return { enviado: false, motivo: 'sin_configuracion' };
  const db = require('./db');
  // Leer en cada envío: vincular, desvincular o eliminar un usuario tiene efecto
  // en el próximo aviso, sin reiniciar ni mantener permisos en una caché.
  const [usuarios, adicionales] = await Promise.all([
    db.listarUsuariosAdmin(), db.listarDestinatariosNotificaciones(),
  ]);
  const destinatarios = seleccionarDestinatarios({ usuarios, adicionales, principal: c.to }, tipo);
  if (!destinatarios.length) return { enviado: false, motivo: 'sin_destinatarios' };
  const info = await transport.sendMail({
    ...contenido,
    from: '"Fresatanika ✦" <' + c.from + '>',
    // No revelar entre destinatarios los correos de los demás usuarios.
    bcc: destinatarios,
  });
  if (!Array.isArray(info.accepted) || info.accepted.length !== destinatarios.length || info.rejected?.length) {
    return { enviado: false, motivo: 'destinatario_no_aceptado' };
  }
  return { enviado: true, id: info.messageId };
}

function obtenerConfig() {
  const user = process.env.SMTP_USER || 'admin@fourone.com.do';
  return {
    host: process.env.SMTP_HOST || 'smtp.zoho.com',
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    user: user,
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || user,
    to: process.env.NOTIFY_TO || user,
  };
}

function crearTransport() {
  const c = obtenerConfig();
  if (!c.pass) return null;
  return nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.port === 465,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
    auth: { user: c.user, pass: c.pass },
  });
}

async function enviarNotificacion(reg) {
  return enviarInterno({
    subject: '✦ Nuevo agendamiento — ' + (reg.producto || 'Servicio'),
    html: templates.correoNotificacion(reg),
  });
}

async function enviarNotificacionPedido(registros, total) {
  const regs = registros || [];
  const primero = regs[0] || {};
  return enviarInterno({
    subject: '✦ Nuevo pedido (' + regs.length + ' servicios) — ' + (primero.cliente_nombre || 'Cliente'),
    html: templates.correoNotificacionPedido(regs, total),
  });
}

async function enviarSeguimiento(reg, tipo) {
  const plazo = tipo === '5semanas' ? '5 semanas' : '4 meses';
  return enviarInterno({
    subject: '✦ Seguimiento a ' + plazo + ' — ' + (reg.cliente_nombre || reg.producto || 'Cliente'),
    html: templates.correoSeguimiento(reg, tipo),
  });
}

// Aviso al administrador: un trabajo agendado está próximo a su fecha límite
// de entrega (3 días con adelanto, 6 semanas sin él) o ya la venció.
async function enviarAvisoEntrega(reg, info) {
  const d = info || {};
  const asunto = (d.conAdelanto ? '⚡ Entrega URGENTE próxima (adelanto)' : '✦ Entrega próxima') +
    ' — ' + (reg.producto || 'Servicio') + (reg.cliente_nombre ? ' · ' + reg.cliente_nombre : '');
  return enviarInterno({
    subject: asunto,
    html: templates.correoAvisoEntrega(reg, d),
  });
}

/* ---------- Correos dirigidos AL CLIENTE (no al administrador) ---------- */
// Aviso del estado del servicio (agendado, realizado, rechazado). Solo se usa
// con clientes registrados, cuyo correo se conoce por su cuenta.
async function enviarEstadoCliente(estado, datos, to, opciones = {}) {
  const c = obtenerConfig();
  const transport = crearTransport();
  if (!transport) {
    console.warn('[mailer] SMTP_PASS no configurado; se omite el aviso al cliente.');
    return { enviado: false, motivo: 'sin_configuracion' };
  }
  if (!to) return { enviado: false, motivo: 'sin_correo' };
  const armado = templates.correoEstadoCliente(estado, datos || {});
  const info = await transport.sendMail({
    messageId: opciones.messageId,
    from: '"Fresatanika ✦" <' + c.from + '>',
    to: to,
    subject: armado.asunto,
    html: armado.html,
  });
  if (!Array.isArray(info.accepted) || !info.accepted.length || info.rejected?.length) {
    return { enviado: false, motivo: 'destinatario_no_aceptado' };
  }
  console.log('[mailer] Aviso de estado (' + estado + ') enviado al cliente:', info.messageId);
  return { enviado: true, id: info.messageId };
}

// Envía al cliente la evidencia del trabajo (imágenes + notas). Las imágenes se
// adjuntan e incrustan en el correo mediante su Content-ID (cid).
async function enviarEvidenciaCliente(reg, to, rutasFotos, baseUrl) {
  const c = obtenerConfig();
  const transport = crearTransport();
  if (!transport) {
    console.warn('[mailer] SMTP_PASS no configurado; se omite la evidencia al cliente.');
    return { enviado: false, motivo: 'sin_configuracion' };
  }
  if (!to) return { enviado: false, motivo: 'sin_correo' };
  const rutas = Array.isArray(rutasFotos) ? rutasFotos : [];
  const attachments = rutas.map(function (ruta, i) {
    return { filename: 'evidencia-' + (i + 1) + '.jpg', path: ruta, cid: 'evidencia' + i };
  });
  const cids = attachments.map(function (a) { return a.cid; });
  const info = await transport.sendMail({
    from: '"Fresatanika ✦" <' + c.from + '>',
    to: to,
    subject: '✦ La evidencia de tu trabajo — Fresatanika',
    html: templates.correoEvidenciaCliente(reg, cids, baseUrl),
    attachments: attachments,
  });
  console.log('[mailer] Evidencia enviada al cliente:', info.messageId);
  return { enviado: true, id: info.messageId };
}

/* ---------- Alerta de seguridad AL ADMINISTRADOR: inicio de sesión ---------- */
// Se envía en cada intento de acceso al panel (correcto o fallido) para tener
// un aviso inmediato de quién entra. Nunca lanza: los errores solo se registran.
async function enviarAlertaLogin(evento) {
  const e = evento || {};
  const exito = !!e.exito;
  const asunto = (exito ? '✓ Acceso al panel' : '⚠ Intento de acceso al panel') +
    ' — ' + (e.usuario || 'Desconocido');
  return enviarInterno({
    subject: asunto,
    html: templates.correoAlertaLogin(e),
  }, 'seguridad');
}

module.exports = {
  enviarNotificacion: enviarNotificacion,
  enviarNotificacionPedido: enviarNotificacionPedido,
  enviarSeguimiento: enviarSeguimiento,
  enviarAvisoEntrega: enviarAvisoEntrega,
  enviarEstadoCliente: enviarEstadoCliente,
  enviarEvidenciaCliente: enviarEvidenciaCliente,
  enviarAlertaLogin: enviarAlertaLogin,
  crearTransport: crearTransport,
  obtenerConfig: obtenerConfig,
};
