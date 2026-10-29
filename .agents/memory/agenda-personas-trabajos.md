---
name: Personas y trabajos en agenda
description: Qué representa una persona agendada y cómo evitar contar servicios del carrito como clientes distintos.
---

«Personas agendadas» cuenta al cliente que compra, no a la persona sobre la que se realiza el trabajo. Cada servicio sigue siendo un trabajo independiente.

**Why:** El usuario aclaró expresamente que se debe contar «al cliente que compra» al distinguir personas y trabajos; varios servicios de un carrito no son varias personas.

**How to apply:** Conservar estados y acciones individuales de los trabajos. No inferir identidad por nombres iguales. Una cuenta identifica al cliente entre pedidos; para invitados sin cuenta, agrupar por pedido y explicar esa limitación. Contar personas con trabajos confirmados todavía por entregar, sin reducirlas hasta entregar su último trabajo confirmado.

La búsqueda y los filtros de agenda seleccionan compradores completos, no subconjuntos de sus servicios. El límite por página se aplica a compradores; un comprador excepcionalmente grande conserva todos sus trabajos activos.

**Why:** No dividir un comprador entre páginas tiene prioridad sobre imponer un máximo estricto de filas. Buscar un pedido o contacto debe recuperar todos sus servicios, incluso de otros pedidos de la misma cuenta.

**How to apply:** Mantener juntos los trabajos activos del comprador encontrado y explicar en pantalla que los filtros seleccionan grupos completos; los totales globales no se reducen al paginar o buscar.
