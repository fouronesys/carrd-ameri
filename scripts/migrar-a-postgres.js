#!/usr/bin/env node
'use strict';

// Migración manual de los datos de los archivos JSON a PostgreSQL.
//
// A diferencia del arranque normal del servidor (que solo importa las tablas
// vacías), este script fuerza la importación de TODOS los registros presentes en
// los archivos JSON. Es idempotente: usa INSERT ... ON CONFLICT DO NOTHING, así
// que ejecutarlo varias veces no duplica ni sobrescribe datos ya migrados.
//
// Los archivos JSON se conservan intactos como respaldo.
//
// Uso:  DATABASE_URL=postgres://... node scripts/migrar-a-postgres.js

const db = require('../lib/db');

async function main() {
  console.log('== Migración JSON -> PostgreSQL ==');
  console.log('Datos de origen (JSON): ' + db.DATA_DIR);

  await db.verificarConexion();
  console.log('Conexión a PostgreSQL verificada.');

  // Crea el esquema si aún no existe (no migra nada por sí solo aquí).
  await db.init();

  // Fuerza la importación completa (soloSiVacio:false); ON CONFLICT evita duplicados.
  const resumen = await db.migrarDesdeJSON({ soloSiVacio: false });

  console.log('Registros nuevos importados por tabla:');
  console.log(JSON.stringify(resumen, null, 2));
  console.log('Migración completada. Los archivos JSON se conservan como respaldo.');
}

main()
  .then(async function () {
    await db.cerrar();
    process.exit(0);
  })
  .catch(async function (e) {
    console.error('Error en la migración:', e);
    try { await db.cerrar(); } catch (err) { /* noop */ }
    process.exit(1);
  });
