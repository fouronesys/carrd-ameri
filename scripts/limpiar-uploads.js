'use strict';

// Sin init/migraciones ni cambios de registros. Por defecto solo informa.
const db = require('../lib/db');

(async () => {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== '--aplicar')) throw new Error('Uso: node scripts/limpiar-uploads.js [--aplicar]');
    const informe = await db.limpiarUploadsHuerfanos({ simular: !args.includes('--aplicar') });
    console.log(JSON.stringify(informe, null, 2));
    if (informe.errores) process.exitCode = 1;
  } catch (e) {
    console.error('Limpieza cancelada:', e.message);
    process.exitCode = 1;
  } finally { await db.cerrar(); }
})();
