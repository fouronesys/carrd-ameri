'use strict';

const addressparser = require('nodemailer/lib/addressparser');

function normalizarCorreo(valor) {
  return String(valor || '').trim().toLowerCase();
}

// Una sola dirección, sin listas, nombres visibles ni caracteres de cabecera.
function correoValido(valor) {
  return valor.length <= 254 && /^[^\s@<>,;:"\\]+@[^\s@<>,;:"\\]+\.[^\s@<>,;:"\\]+$/.test(valor);
}

function rolValido(rol) {
  return rol === 'admin' || rol === 'asistente';
}

function seleccionarDestinatarios({ usuarios = [], adicionales = [], principal = '' }, tipo) {
  if (!['operativo', 'seguridad'].includes(tipo)) throw new Error('Tipo de notificación desconocido');
  const correos = new Set();
  function agregar(email, rol) {
    if (!rolValido(rol) || (tipo === 'seguridad' && rol !== 'admin')) return;
    const normalizado = normalizarCorreo(email);
    if (correoValido(normalizado)) correos.add(normalizado);
  }
  // Mantener compatibles las listas y nombres visibles del destinatario original.
  for (const direccion of addressparser(principal, { flatten: true })) agregar(direccion.address, 'admin');
  for (const usuario of usuarios) agregar(usuario.email, usuario.rol);
  for (const destinatario of adicionales) agregar(destinatario.email, destinatario.rol);
  return [...correos];
}

module.exports = { normalizarCorreo, correoValido, rolValido, seleccionarDestinatarios };
