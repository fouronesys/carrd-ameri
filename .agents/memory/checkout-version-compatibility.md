---
name: Compatibilidad de formularios de pago abiertos
description: Las pestañas antiguas pueden seguir enviando contratos anteriores después de desplegar.
---

No asumir que un despliegue actualiza el JavaScript de las pestañas ya abiertas. Mantener un rechazo accionable para formularios sin cotización firmada, sin crear pedidos ni aceptar precios enviados por el navegador.

**Why:** Se recibió una captura con un total visible y controles antiguos COP/USD, pero el servidor rechazaba la solicitud por ausencia de cotización. La versión publicada nueva sí cotizaba correctamente. Un importe visible no prueba que exista una cotización autorizada.

**How to apply:** Al cambiar el contrato de compra, probar clientes anteriores y explicar cómo recargar; versionar recursos ayuda en nuevas cargas, pero no reemplaza el código que ya ejecuta una pestaña.
