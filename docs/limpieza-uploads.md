# Limpieza conservadora de cargas

El servidor revisa `DATA_DIR/uploads` al arrancar y cada hora, junto con el ciclo
de limpieza existente. No se ejecuta automáticamente en `FRESA_PREVIEW=1`.

- Conserva al menos 24 horas desde la fecha más reciente entre creación del
  nombre, modificación y cambio de metadatos del archivo.
- Solo examina archivos regulares con nombres generados por multer; no sigue
  enlaces ni recorre carpetas.
- Consulta todos los agendamientos, incluidos eliminados y realizados:
  `objetivo_foto`, `comprobante` y `evidencia_fotos`.
- Conserva también todas las fotos de `evidencia_operaciones`, cualquiera que sea
  el estado del correo. No elimina operaciones ni historial.
- Omite el ciclo si hay subidas activas en cualquiera de las instancias
  actualizadas o si ya hay otra limpieza. Un bloqueo compartido de PostgreSQL
  protege la subida y su guardado, incluso si el navegador se desconecta.
- Espera las escrituras SQL en curso y bloquea cambios en las referencias durante
  la revisión. Si no consigue hacerlo en dos segundos o falla la consulta, no
  empieza a borrar. Los errores al borrar archivos se cuentan y se reintentan
  en otro ciclo.

Comprobación manual, sin borrar:

```
node scripts/limpiar-uploads.js
```

Para aplicar con las mismas garantías:

```
node scripts/limpiar-uploads.js --aplicar
```

Usa únicamente el directorio persistente y la base de datos correspondientes a
la misma instalación. El informe incluye archivos revisados, recientes,
referenciados, candidatos, eliminados y errores; no expone nombres ni notas.
Un resultado omitido no equivale a una revisión satisfactoria.

En una actualización con varias instancias, todas deben usar esta protección
antes de activar la limpieza: una versión anterior no registra sus subidas
activas. La gracia protege las cargas recientes, pero no sustituye el bloqueo
para solicitudes de más de 24 horas.
