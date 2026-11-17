---
name: Coordinación de limpieza de archivos
description: Por qué las subidas y la limpieza requieren coordinación SQL compatible con agrupadores transaccionales.
---

La protección de subidas y limpieza entre instancias debe usar bloqueos ligados
a una transacción, no bloqueos de sesión.

**Why:** La instalación usa un host PostgreSQL agrupador; un agrupador por
transacción puede devolver otro servidor entre consultas y dejar un bloqueo de
sesión retenido o sin protección. Además, una respuesta HTTP perdida no significa
que el guardado haya terminado: no liberar protección solo por cerrar la conexión
del navegador.

**How to apply:** Mantener la transacción protectora hasta terminar el trabajo de
la solicitud, sin ocupar las conexiones que necesita el guardado. No cambiar a
bloqueos de sesión al optimizar conexiones; comprobar fallos antes y después del
COMMIT en PostgreSQL aislado.
