---
name: Delivery notification guarantees
description: SMTP confirmation limits and the choice of delivery guarantees across process crashes.
---

Delivery notices must favor recovery over silently losing a message. Do not
claim that ordinary SMTP can provide exactly-once delivery across process death.

**Why:** SMTP acceptance and a PostgreSQL commit cannot participate in the same
atomic transaction. A crash between them leaves an ambiguous result. A stable
Message-ID can help receivers deduplicate, but does not guarantee they will.

**How to apply:** Preserve the at-least-once guarantee and disclose the narrow
duplicate window. A requirement to eliminate even that window needs an email
provider with server-side idempotency, not a pre-send success flag.

## Evidencia enviada manualmente

Los envíos manuales de evidencia tienen una garantía distinta: reintentar una
operación confirmada no debe repetir sus fotos ni su intento de correo. Si SMTP
queda ambiguo, conservar la evidencia y comunicar la incertidumbre; nunca
interpretar el reintento de esa operación como autorización para reenviarlo.
Un envío intencional posterior es una operación distinta.

Que el cliente informe que no recibió la evidencia es una gestión de contacto,
no un resultado de SMTP ni una recepción verificada. Debe conservarse aparte y
mantener el pendiente visible, sin autorizar un reenvío.

**Why:** El seguimiento manual debe distinguir lo que informó el cliente de lo
que confirmó el servidor de correo, sin perder la trazabilidad del contacto.

**How to apply:** Conservar estas gestiones incluso si después se verifica la
recepción; no convertirlas en fallos SMTP ni en instrucciones de envío.

**Why:** El usuario exige reintentos explícitos sin duplicar evidencia ni correos
y prohíbe reenvíos automáticos en este flujo.

**How to apply:** No extender la recuperación automática de los avisos de
entrega a la evidencia manual. No prometer entrega garantizada de correo ante
una caída entre guardar la operación y confirmar SMTP; revisar la recepción
antes de iniciar otro envío.
