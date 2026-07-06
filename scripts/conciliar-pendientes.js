#!/usr/bin/env node
'use strict';

// Conciliación manual de pagos Wompi pendientes.
//
// Busca todos los agendamientos/pedidos que quedaron en estado
// 'pendiente_pago' y consulta en la API de Wompi (por referencia) si en
// realidad ya fueron aprobados. Si lo fueron, los agenda y envía el correo de
// confirmación al cliente, reutilizando exactamente la misma lógica del
// servidor (server.js). Es idempotente: los que ya están agendados se ignoran.
//
// Esto reutiliza el mismo código que corre automáticamente en cada arranque del
// servidor; sirve para forzar una pasada explícita y visible (por ejemplo, como
// paso de despliegue en CapRover o desde una terminal one-off), sin tener que
// reiniciar la aplicación.
//
// Uso:  DATABASE_URL=postgres://... node scripts/conciliar-pendientes.js
//
// Requisitos de entorno (los mismos del servidor, porque importa server.js):
//   - DATABASE_URL (o PGHOST/PGDATABASE/...)  -> acceso a PostgreSQL
//   - SESSION_SECRET (obligatorio en producción; server.js lo exige al cargar)
//   - WOMPI_PUBLIC_KEY                          -> determina sandbox vs producción
//   - SMTP_PASS (opcional)                      -> para enviar el correo de aviso
//
// En CapRover ya están definidas para la app, así que basta ejecutarlo desde la
// terminal de la propia aplicación (o un `docker exec` en su contenedor).

const db = require('../lib/db');
// Importar server.js NO levanta el servidor HTTP (usa require.main === module);
// solo expone reconciliarPagosPendientes y las funciones de confirmación.
const server = require('../server');

async function main() {
  console.log('== Conciliación de pagos Wompi pendientes ==');

  // Verifica la conexión y crea el esquema si hiciera falta (idempotente).
  await db.verificarConexion();
  console.log('Conexión a PostgreSQL verificada.');
  await db.init();

  const res = await server.reconciliarPagosPendientes();

  console.log('');
  console.log('Pagos recuperados y agendados en esta pasada: ' + res.agendados);
  if (res.huboFallos) {
    console.warn(
      'ATENCIÓN: alguna consulta a Wompi no se pudo resolver (API caída, red, ' +
      'respuesta no OK). Es posible que queden pendientes sin verificar; vuelve ' +
      'a ejecutar el script más tarde para reintentarlos.'
    );
  } else {
    console.log('Todos los pendientes se verificaron correctamente contra Wompi.');
  }

  // Código de salida distinto de cero si hubo fallos de verificación, para que
  // un paso de despliegue pueda detectarlo si así lo desea.
  return res.huboFallos ? 1 : 0;
}

main()
  .then(async function (codigo) {
    await db.cerrar();
    process.exit(codigo);
  })
  .catch(async function (e) {
    console.error('[conciliacion] Error fatal:', e && e.message ? e.message : e);
    try { await db.cerrar(); } catch (_) {}
    process.exit(1);
  });
