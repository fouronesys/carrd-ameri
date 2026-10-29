---
name: Divisas del catálogo
description: Divisas solicitadas y regla comercial de usar USD como base con actualización automática.
---

El dólar USD es la referencia para las tasas automáticas de las divisas del catálogo. Los precios originales COP deben mantenerse fijos: no recalcularlos desde la tarifa USD.

Divisas solicitadas: USD, EUR, pesos mexicanos (MXN), soles peruanos (PEN), DOP, ARS, reales brasileños (BRL), CLP, guaraní paraguayo (PYG) y bolívar venezolano (VES). Conservar COP como moneda local.

**Why:** El usuario indicó «se toma el dolar como referencia», enumeró estas divisas y eligió tasas automáticas. Después corrigió explícitamente: «Los precios en COP, no debían moverse, los que estaban debían quedarse así».

**How to apply:** Diferenciar divisa de visualización, precio base USD y moneda real de cobro. No asumir que una pasarela admite todas las divisas mostradas. Wompi Colombia documenta únicamente COP para el cobro: https://docs.wompi.co/docs/colombia/widget-checkout-web/ . No cambiar importes de pedidos ya registrados al actualizar las tasas.

El usuario confirmó «Convertir y cobrar en COP»: Wompi y las transferencias usan COP. Su corrección posterior exige conservar las tarifas COP originales y no sustituirlas por la conversión de la tarifa USD.

Hay **tarifas COP y USD independientes**. Si el cliente elige COP, el precio base y sus descuentos/urgencias usan la tarifa COP original. Si elige USD u otra divisa extranjera, la referencia es la tarifa USD; Wompi y la transferencia siguen cobrando su conversión a COP.

**Why:** Al aclarar que ambas tarifas originales no siempre equivalen, el usuario eligió expresamente «Tarifas COP y USD independientes».

**How to apply:** No sustituir la tarifa COP por USD multiplicado por la tasa, ni la tarifa USD por una conversión inversa de COP. El coste puede ser diferente según la tarifa elegida. Mantener coherentes catálogo, filtros de presupuesto, carrito, descuentos, urgencias y cotización final. No recalcular pedidos ya registrados con una tarifa distinta.

En reportes y contabilidad, los metadatos históricos ausentes deben quedar identificados como no registrados, sin inferir tarifa, divisa o tasa a partir del importe ni de otros campos.

**Why:** El usuario pidió distinguir los registros antiguos sin metadatos y no inferir tasas faltantes.

**How to apply:** Una divisa vista extranjera no prueba por sí sola qué tarifa se aplicó; una tasa guardada tampoco prueba la divisa vista. Conservar los ingresos reales en COP.

**Why:** El usuario eligió explícitamente esta opción tras aclarar la limitación de Wompi Colombia. Después precisó que no es necesario mostrar el total en COP en nuestra página porque Wompi ya lo hará.

**How to apply:** Antes de ir a Wompi, mostrar el total en la divisa elegida, sin duplicar un importe COP si se seleccionó una moneda extranjera; Wompi mostrará el cargo COP. Una aclaración breve de la moneda de cobro no necesita repetir su importe. No añadir una modalidad de cobro en USD ni otra pasarela solo por seleccionar una divisa extranjera. No inventar conversiones si faltan tasas vigentes. El precio COP original es una tarifa que debe respetarse, no una conversión histórica que deba reemplazarse automáticamente.
