---
name: Puertos temporales de prueba
description: Evitar que las verificaciones aisladas dejen cambios de configuración ajenos a la aplicación.
---

Un servidor temporal usado para pruebas de navegador puede registrar automáticamente su puerto en `.replit`, aunque no sea un workflow. Detener el proceso no elimina necesariamente ese puerto.

**Why:** La verificación aislada añadió una asignación de puerto sin que la solicitara el usuario. Las herramientas bloquean las ediciones directas de `.replit`.

**How to apply:** Revisar el diff de configuración al cerrar el servidor temporal y eliminar solo su asignación, conservando todos los workflows y puertos originales. Para modificar `.replit`, escribir el TOML completo actualizado en un archivo temporal con ruta absoluta dentro del workspace y llamar `verifyAndReplaceDotReplit({tempFilePath})`; esa operación valida el esquema antes de sustituirlo. No reiniciar los servidores con acceso a datos reales solo para comprobar un cambio de interfaz.
