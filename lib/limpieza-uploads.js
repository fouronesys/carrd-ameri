'use strict';

const fs = require('node:fs');
const path = require('node:path');

const GRACIA_MS = 24 * 60 * 60 * 1000;
// Solo nombres emitidos por nuestro almacenamiento multer. Nunca recorrer
// subdirectorios, enlaces simbólicos ni archivos ajenos a las cargas.
const NOMBRE_CARGA = /^\d{13}-[a-f0-9]{12}\.(?:jpg|png|webp)$/;

async function revisarDirectorio({ directorio, referencias, simular, graciaMs, ahora, verificarProteccion }) {
  const informe = { revisados: 0, recientes: 0, referenciados: 0, candidatos: 0, eliminados: 0, errores: 0 };
  const entradas = await fs.promises.readdir(directorio, { withFileTypes: true });
  for (const entrada of entradas) {
    if (!entrada.isFile() || !NOMBRE_CARGA.test(entrada.name)) continue;
    const archivo = path.join(directorio, entrada.name);
    try {
      const stat = await fs.promises.lstat(archivo);
      if (!stat.isFile()) continue;
      informe.revisados++;
      // ctime también protege archivos recién copiados con mtime antiguo.
      if (Math.max(stat.mtimeMs, stat.ctimeMs, Number(entrada.name.slice(0, 13))) > ahora - graciaMs) {
        informe.recientes++;
      } else if (referencias.has(entrada.name)) {
        informe.referenciados++;
      } else {
        informe.candidatos++;
        if (!simular) {
          // Fuera de la captura de errores de archivos: perder el lock SQL
          // debe abortar el ciclo entero, no continuar con una lista antigua.
          try { await verificarProteccion(); }
          catch (e) { e.proteccionPerdida = true; throw e; }
          await fs.promises.unlink(archivo);
          informe.eliminados++;
        }
      }
    } catch (e) {
      if (e.proteccionPerdida) throw e;
      if (e.code !== 'ENOENT') informe.errores++;
    }
  }
  return informe;
}

module.exports = { GRACIA_MS, revisarDirectorio };
