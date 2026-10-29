---
name: Divisas del catálogo
description: Divisas solicitadas y regla comercial de usar USD como base con actualización automática.
---

El dólar USD es la referencia para convertir los precios del catálogo. El usuario pidió tasas automáticas y que la conversión cambie el importe cobrado, no solo el texto visible.

Divisas solicitadas: USD, EUR, pesos mexicanos (MXN), soles peruanos (PEN), DOP, ARS, reales brasileños (BRL), CLP, guaraní paraguayo (PYG) y bolívar venezolano (VES). Conservar COP como moneda local.

**Why:** El usuario indicó «se toma el dolar como referencia», enumeró estas divisas y eligió «Automáticamente» y «También cambiar el importe cobrado».

**How to apply:** Diferenciar divisa de visualización, precio base USD y moneda real de cobro. No asumir que una pasarela admite todas las divisas mostradas. Wompi Colombia documenta únicamente COP para el cobro: https://docs.wompi.co/docs/colombia/widget-checkout-web/ . No cambiar importes de pedidos ya registrados al actualizar las tasas.
