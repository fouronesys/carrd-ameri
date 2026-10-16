'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const usuarios = [
  { id: '1', rol: 'admin', email: 'admin@example.invalid' },
  { id: '2', rol: 'asistente', email: 'asistente@example.invalid' },
];
const adicionales = [{ rol: 'asistente', email: 'ASISTENTE@example.invalid' }];
let falloDb = false, rechazar = false, correos = [];
const id = require.resolve('../lib/db');
require.cache[id] = { id, filename: id, loaded: true, exports: {
  listarUsuariosAdmin: async () => { if (falloDb) throw new Error('DB no disponible'); return usuarios; },
  listarDestinatariosNotificaciones: async () => adicionales,
} };
nodemailer.createTransport = () => ({
  sendMail: async correo => {
    correos.push(correo);
    const destinos = correo.bcc || [correo.to];
    return {
      messageId: 'prueba-local',
      accepted: rechazar ? destinos.slice(1) : destinos,
      rejected: rechazar ? destinos.slice(0, 1) : [],
    };
  },
});
// Valores sintéticos; ningún correo sale del proceso.
process.env.SMTP_PASS = 'fake-for-stub-only';
process.env.SMTP_FROM = 'emisor@example.invalid';
process.env.SMTP_USER = 'emisor@example.invalid';
process.env.NOTIFY_TO = 'principal@example.invalid';
const mailer = require('../lib/mailer');
const reg = {
  ref: 'TEST', estado: 'agendado', producto: 'Prueba', cliente_nombre: 'Prueba',
  creado_en: '2026-01-01', precio_cop: 20000, cliente_email: 'cliente@example.invalid',
};

test('Todos los avisos operativos llegan a los vinculados, sin duplicados y con copia oculta', async () => {
  const enviar = [
    () => mailer.enviarNotificacion(reg),
    () => mailer.enviarNotificacionPedido([reg], 20000),
    () => mailer.enviarSeguimiento(reg, '5semanas'),
    () => mailer.enviarSeguimiento(reg, '4meses'),
    () => mailer.enviarAvisoEntrega(reg, { conAdelanto: true }),
  ];
  for (const fn of enviar) {
    assert.equal((await fn()).enviado, true);
    const correo = correos.at(-1);
    assert.deepEqual(correo.bcc, ['principal@example.invalid', 'admin@example.invalid', 'asistente@example.invalid']);
    assert.equal(correo.to, undefined);
    assert.equal(correo.cc, undefined);
  }
});

test('Alertas de acceso exitoso/fallido solo para administradores', async () => {
  for (const exito of [true, false]) {
    await mailer.enviarAlertaLogin({ usuario: 'prueba', rol: 'asistente', exito });
    assert.deepEqual(correos.at(-1).bcc, ['principal@example.invalid', 'admin@example.invalid']);
  }
});

test('Los cambios y eliminaciones surten efecto en el siguiente envío', async () => {
  usuarios[1].email = 'nuevo@example.invalid';
  adicionales.length = 0;
  await mailer.enviarNotificacion(reg);
  assert.deepEqual(correos.at(-1).bcc, ['principal@example.invalid', 'admin@example.invalid', 'nuevo@example.invalid']);
  usuarios[1].email = '';
  usuarios.splice(0, 1);
  await mailer.enviarNotificacion(reg);
  assert.deepEqual(correos.at(-1).bcc, ['principal@example.invalid']);
});

test('Los mensajes privados al cliente nunca se copian a usuarios del panel', async () => {
  await mailer.enviarEstadoCliente('agendado', reg, 'cliente@example.invalid');
  assert.equal(correos.at(-1).to, 'cliente@example.invalid');
  assert.equal(correos.at(-1).bcc, undefined);
  await mailer.enviarEvidenciaCliente(reg, 'cliente@example.invalid', [], 'https://ejemplo.invalid');
  assert.equal(correos.at(-1).to, 'cliente@example.invalid');
  assert.equal(correos.at(-1).bcc, undefined);
});

test('No se confirma envío completo con rechazo parcial o fallo de base de datos', async () => {
  rechazar = true;
  assert.equal((await mailer.enviarNotificacion(reg)).enviado, false);
  rechazar = false;
  falloDb = true;
  const antes = correos.length;
  await assert.rejects(mailer.enviarNotificacion(reg), /DB no disponible/);
  assert.equal(correos.length, antes);
});
