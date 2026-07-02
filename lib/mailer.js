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

module.exports = {
  enviarNotificacion: enviarNotificacion,
  enviarSeguimiento: enviarSeguimiento,
  crearTransport: crearTransport,
  obtenerConfig: obtenerConfig,
};
