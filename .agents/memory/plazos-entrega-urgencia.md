---
name: Plazos de entrega con urgencia
description: Criterio del reloj y compatibilidad de recordatorios cuando cambia la vinculación de un adelanto.
---

El adelanto independiente no es un servicio por entregar. Solo acelera el servicio explícitamente vinculado mientras ambos registros estén pagados y activos. Los tres días se cuentan desde el último pago entre ambos, sin superar la fecha normal de entrega de seis semanas. Cambiar la vinculación no reinicia el reloj.

**Why:** Contar desde la compra antigua del servicio podría declarar vencida una urgencia recién pagada; contar desde cada reasignación permitiría renovar artificialmente el plazo. La urgencia tampoco debe retrasar un compromiso existente.

**How to apply:** Conservar la fecha de los pagos como origen del cálculo. Reasignar, desvincular, entregar o anular un registro cambia el plazo aplicable, no las fechas de pago.

Un recordatorio confirmado corresponde a un plazo y un origen de urgencia concretos, no bloquea todos los avisos futuros de ese servicio.

**Why:** Una marca histórica de aviso normal no debe silenciar una urgencia adquirida posteriormente; quitar y volver a poner el mismo adelanto tampoco debe repetir el mismo aviso.

**How to apply:** Conservar la compatibilidad de las marcas antiguas y recordar los plazos ya avisados. Confirmar envío solo tras aceptación del correo; SMTP no ofrece exactamente una entrega ante caídas del proceso.
