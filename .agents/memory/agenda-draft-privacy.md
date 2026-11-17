---
name: Privacidad de borradores de agenda
description: Decisión de proteger borradores mediante advertencias, sin persistir notas ni archivos de clientes.
---

Proteger los borradores de evidencia y edición de agenda mediante confirmación antes de descartarlos, sin guardarlos de forma permanente ni reenviar evidencia automáticamente.

**Why:** El usuario permite advertir o restaurar por referencia, pero exige incluir la selección de archivos, respetar el cierre de sesión y evitar persistir datos sensibles de clientes. Se eligieron advertencias para no crear un nuevo depósito de esos datos.

**How to apply:** Mantener notas y archivos únicamente en los formularios abiertos. Si se propone recuperación entre recargas o sesiones, acordar primero su alcance de privacidad; no añadir localStorage, IndexedDB ni almacenamiento de archivos como una mejora implícita.
