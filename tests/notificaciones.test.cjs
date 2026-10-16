'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { seleccionarDestinatarios, correoValido } = require('../lib/notificaciones');

test('Distribución por rol, normalización, listas originales y duplicados', () => {
  const datos = {
    principal: 'Principal <base@example.invalid>, otra@example.invalid',
    usuarios: [
      { rol: 'admin', email: ' ADMIN@EXAMPLE.INVALID ' },
      { rol: 'asistente', email: 'asistente@example.invalid' },
      { rol: 'asistente', email: 'base@example.invalid' },
      { rol: 'otro', email: 'no@example.invalid' },
      { rol: 'admin', email: 'sin dirección válida' },
      { rol: 'admin' },
    ],
    adicionales: [
      { rol: 'asistente', email: 'ASISTENTE@example.invalid' },
      { rol: 'admin', email: 'extra@example.invalid' },
    ],
  };
  assert.deepEqual(seleccionarDestinatarios(datos, 'operativo'), [
    'base@example.invalid', 'otra@example.invalid', 'admin@example.invalid',
    'asistente@example.invalid', 'extra@example.invalid',
  ]);
  assert.deepEqual(seleccionarDestinatarios(datos, 'seguridad'), [
    'base@example.invalid', 'otra@example.invalid', 'admin@example.invalid', 'extra@example.invalid',
  ]);
  assert.throws(() => seleccionarDestinatarios(datos, 'inexistente'));
  for (const valor of ['', 'dos@example.invalid,tres@example.invalid', 'a@example.invalid\r\nBcc:x@example.invalid', 'Nombre <a@example.invalid>']) {
    assert.equal(correoValido(valor), false);
  }
});

let servidor, url, admin, asistente, fixture;
before(async () => {
  process.env.ADMIN_PASSWORD = 'isolated-admin-test';
  process.env.ASSISTANT_PASSWORD = 'isolated-assistant-test';
  process.env.SESSION_SECRET = 'isolated-session-test-not-a-live-secret';
  process.env.NODE_ENV = 'test';
  fixture = require('./helpers/admin-fixture.cjs');
  servidor = fixture.app.listen(0, '127.0.0.1');
  await new Promise(r => servidor.once('listening', r));
  url = 'http://127.0.0.1:' + servidor.address().port;
  async function login(password) {
    const r = await fetch(url + '/admin/login', {
      method: 'POST', redirect: 'manual', headers: { Origin: url },
      body: new URLSearchParams({ password }),
    });
    assert.equal(r.status, 302);
    return r.headers.get('set-cookie').split(';')[0];
  }
  admin = await login('isolated-admin-test');
  asistente = await login('isolated-assistant-test');
});
after(async () => {
  if (servidor) { servidor.closeAllConnections(); await new Promise(r => servidor.close(r)); }
});
function peticion(ruta, datos, cookie = admin, origen = url) {
  return fetch(url + ruta, {
    method: datos ? 'POST' : 'GET', redirect: 'manual',
    headers: { Cookie: cookie, Origin: origen, Accept: 'application/json' },
    body: datos ? new URLSearchParams(datos) : undefined,
  });
}

test('Crear usuarios con/sin correo, vincular, cambiar y quitar sin alterar rol ni credenciales', async () => {
  const datos = { usuario: 'testadmin', password: 'synthetic-pass', rol: 'admin', email: ' ADMIN@Example.invalid ' };
  let r = await peticion('/admin/usuarios', { ...datos, email: 'inválido' });
  assert.equal(r.status, 400);
  assert.equal(fixture.usuarios.size, 0);
  r = await peticion('/admin/usuarios', datos);
  assert.equal(r.status, 200);
  const u = [...fixture.usuarios.values()][0], id = u.id, hash = u.hash;
  assert.equal(u.email, 'admin@example.invalid');
  r = await peticion('/admin/usuarios', { ...datos, usuario: 'testassist', rol: 'asistente', email: '' });
  assert.equal(r.status, 200);
  const sinCorreo = [...fixture.usuarios.values()].find(x => x.usuario === 'testassist');
  assert.equal(sinCorreo.email, '');
  r = await peticion('/admin/usuarios/' + sinCorreo.id + '/correo', { email: 'asistente@example.invalid' });
  assert.equal(r.status, 200);
  assert.equal(sinCorreo.email, 'asistente@example.invalid');
  r = await peticion('/admin/usuarios/' + sinCorreo.id + '/correo', { email: 'nuevo@example.invalid', rol: 'admin', hash: 'no' });
  assert.equal(r.status, 200);
  assert.equal(sinCorreo.rol, 'asistente');
  r = await peticion('/admin/usuarios/' + id + '/correo', { email: '' });
  assert.equal(r.status, 200);
  assert.equal(u.email, '');
  assert.equal(u.hash, hash);
  r = await peticion('/admin/usuarios/' + id + '/correo', { email: 'a@example.invalid\nBcc:b@example.invalid' });
  assert.equal(r.status, 400);
  assert.equal(u.email, '');
  r = await peticion('/admin/usuarios/desconocido/correo', { email: '' });
  assert.equal(r.status, 404);
  const html = await (await peticion('/admin?tab=usuarios')).text();
  assert.ok(html.includes('asistente') && html.includes('nuevo@example.invalid'));
  assert.ok(html.includes('Notificaciones por correo'));
  await peticion('/admin/usuarios/eliminar/' + id, {});
  assert.equal(fixture.usuarios.has(id), false);
});

test('Crear, editar y eliminar destinatarios, validar roles y correos duplicados', async () => {
  let r = await peticion('/admin/notificaciones', { email: 'aviso@example.invalid', rol: 'superadmin' });
  assert.equal(r.status, 400);
  r = await peticion('/admin/notificaciones', { email: 'aviso@example.invalid', rol: 'asistente' });
  assert.equal(r.status, 200);
  const id = [...fixture.destinatarios.keys()][0];
  r = await peticion('/admin/notificaciones', { email: ' AVISO@EXAMPLE.INVALID ', rol: 'admin' });
  assert.equal(r.status, 409);
  assert.equal(fixture.destinatarios.size, 1);
  r = await peticion('/admin/notificaciones/' + id, { email: 'cambiado@example.invalid', rol: 'admin' });
  assert.equal(r.status, 200);
  let html = await (await peticion('/admin?tab=usuarios')).text();
  assert.ok(html.includes('value="cambiado@example.invalid"'));
  assert.equal(fixture.destinatarios.get(id).rol, 'admin');
  r = await peticion('/admin/notificaciones/noexiste', { email: 'valido@example.invalid', rol: 'admin' });
  assert.equal(r.status, 404);
  r = await peticion('/admin/notificaciones/' + id + '/eliminar', {});
  assert.equal(r.status, 200);
  assert.equal(fixture.destinatarios.size, 0);
  html = await (await peticion('/admin?tab=usuarios')).text();
  assert.equal(html.includes('cambiado@example.invalid'), false);
});

test('Asistentes, solicitudes sin sesión y otros orígenes no pueden gestionar destinatarios ni correos', async () => {
  const rutas = [
    '/admin/notificaciones', '/admin/notificaciones/id', '/admin/notificaciones/id/eliminar',
    '/admin/usuarios', '/admin/usuarios/id/correo', '/admin/usuarios/eliminar/id',
  ];
  for (const ruta of rutas) {
    assert.equal((await peticion(ruta, { email: 'intruso@example.invalid', rol: 'admin' }, asistente)).status, 403);
    assert.equal((await peticion(ruta, {}, '')).status, 302);
    assert.equal((await peticion(ruta, {}, admin, 'https://otro.example.invalid')).status, 403);
  }
  const html = await (await peticion('/admin?tab=usuarios', null, asistente)).text();
  assert.equal(html.includes('Notificaciones por correo'), false);
  assert.equal(html.includes('nuevo@example.invalid'), false);
});
