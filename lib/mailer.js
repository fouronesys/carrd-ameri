'use strict';

const nodemailer = require('nodemailer');
const templates = require('./templates');

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
    auth: { user: c.user, pass: c.pass },
  });
}

async function enviarNotificacion(reg) {
  const c = obtenerConfig();
  const transport = crearTransport();
  if (!transport) {
    console.warn('[mailer] SMTP_PASS no configurado; se omite el envío del correo.');
    return { enviado: false, motivo: 'sin_configuracion' };
  }
  const html = templates.correoNotificacion(reg);
  const info = await transport.sendMail({
    from: '"Fresatanika ✦" <' + c.from + '>',
    to: c.to,
    subject: '✦ Nuevo agendamiento — ' + (reg.producto || 'Servicio'),
    html: html,
  });
  console.log('[mailer] Notificación enviada:', info.messageId);
  return { enviado: true, id: info.messageId };
}

async function enviarNotificacionPedido(registros, total) {
  const c = obtenerConfig();
  const transport = crearTransport();
  if (!transport) {
    console.warn('[mailer] SMTP_PASS no configurado; se omite el correo del pedido.');
    return { enviado: false, motivo: 'sin_configuracion' };
  }
  const regs = registros || [];
  const primero = regs[0] || {};
  const html = templates.correoNotificacionPedido(regs, total);
  const info = await transport.sendMail({
    from: '"Fresatanika ✦" <' + c.from + '>',
    to: c.to,
    subject: '✦ Nuevo pedido (' + regs.length + ' servicios) — ' + (primero.cliente_nombre || 'Cliente'),
    html: html,
  });
  console.log('[mailer] Notificación de pedido enviada:', info.messageId);
  return { enviado: true, id: info.messageId };
}

async function enviarSeguimiento(reg, tipo) {
  const c = obtenerConfig();
  const transport = crearTransport();
  if (!transport) {
    console.warn('[mailer] SMTP_PASS no configurado; se omite el recordatorio de seguimiento.');
    return { enviado: false, motivo: 'sin_configuracion' };
  }
  const plazo = tipo === '5semanas' ? '5 semanas' : '4 meses';
  const html = templates.correoSeguimiento(reg, tipo);
  const info = await transport.sendMail({
    from: '"Fresatanika ✦" <' + c.from + '>',
    to: c.to,
    subject: '✦ Seguimiento a ' + plazo + ' — ' + (reg.cliente_nombre || reg.producto || 'Cliente'),
    html: html,
  });
  console.log('[mailer] Recordatorio de seguimiento (' + plazo + ') enviado:', info.messageId);
  return { enviado: true, id: info.messageId };
}

// Aviso al administrador: un trabajo agendado está próximo a su fecha límite
// de entrega (3 días con adelanto, 6 semanas sin él) o ya la venció.
async function enviarAvisoEntrega(reg, info) {
  const c = obtenerConfig();
  const transport = crearTransport();
  if (!transport) {
    console.warn('[mailer] SMTP_PASS no configurado; se omite el aviso de entrega.');
    return { enviado: false, motivo: 'sin_configuracion' };
  }
  const d = info || {};
  const asunto = (d.conAdelanto ? '⚡ Entrega URGENTE próxima (adelanto)' : '✦ Entrega próxima') +
    ' — ' + (reg.producto || 'Servicio') + (reg.cliente_nombre ? ' · ' + reg.cliente_nombre : '');
  const infoMail = await transport.sendMail({
    from: '"Fresatanika ✦" <' + c.from + '>',
    to: c.to,
    subject: asunto,
    html: templates.correoAvisoEntrega(reg, d),
  });
  console.log('[mailer] Aviso de entrega enviado:', infoMail.messageId);
  return { enviado: true, id: infoMail.messageId };
}

/* ---------- Correos dirigidos AL CLIENTE (no al administrador) ---------- */
// Aviso del estado del servicio (agendado, realizado, rechazado). Solo se usa
// con clientes registrados, cuyo correo se conoce por su cuenta.
async function enviarEstadoCliente(estado, datos, to) {
  const c = obtenerConfig();
  const transport = crearTransport();
  if (!transport) {
    console.warn('[mailer] SMTP_PASS no configurado; se omite el aviso al cliente.');
    return { enviado: false, motivo: 'sin_configuracion' };
  }
  if (!to) return { enviado: false, motivo: 'sin_correo' };
  const armado = templates.correoEstadoCliente(estado, datos || {});
  const info = await transport.sendMail({
    from: '"Fresatanika ✦" <' + c.from + '>',
    to: to,
    subject: armado.asunto,
    html: armado.html,
  });
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
  const c = obtenerConfig();
  const transport = crearTransport();
  if (!transport) {
    console.warn('[mailer] SMTP_PASS no configurado; se omite la alerta de inicio de sesión.');
    return { enviado: false, motivo: 'sin_configuracion' };
  }
  const e = evento || {};
  const exito = !!e.exito;
  const asunto = (exito ? '✓ Acceso al panel' : '⚠ Intento de acceso al panel') +
    ' — ' + (e.usuario || 'Desconocido');
  const info = await transport.sendMail({
    from: '"Fresatanika ✦" <' + c.from + '>',
    to: c.to,
    subject: asunto,
    html: templates.correoAlertaLogin(e),
  });
  console.log('[mailer] Alerta de inicio de sesión enviada:', info.messageId);
  return { enviado: true, id: info.messageId };
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
