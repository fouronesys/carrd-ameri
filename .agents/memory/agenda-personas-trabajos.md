---
name: Personas y trabajos en agenda
description: Qué representa una persona agendada y cómo evitar contar servicios del carrito como clientes distintos.
---

«Personas agendadas» cuenta al cliente que compra, no a la persona sobre la que se realiza el trabajo. Cada servicio sigue siendo un registro independiente. El usuario también pidió «que las lecturas y los trabajos se separen en el panel».

**Why:** El usuario aclaró expresamente que se debe contar «al cliente que compra» al distinguir personas y trabajos; varios servicios de un carrito no son varias personas. Pidió separar lecturas de trabajos para no mezclar esas actividades ni sus contadores.

**How to apply:** Conservar estados y acciones individuales de los trabajos. No inferir identidad por nombres iguales. Una cuenta identifica al cliente entre pedidos; para invitados sin cuenta, agrupar por pedido y explicar esa limitación. Contar personas con trabajos confirmados todavía por entregar, sin reducirlas hasta entregar su último trabajo confirmado.

La búsqueda y los filtros de agenda seleccionan compradores completos, no subconjuntos de sus servicios. El límite por página se aplica a compradores; un comprador excepcionalmente grande conserva todos sus trabajos activos.

**Why:** No dividir un comprador entre páginas tiene prioridad sobre imponer un máximo estricto de filas. Buscar un pedido o contacto debe recuperar todos sus servicios, incluso de otros pedidos de la misma cuenta.

**How to apply:** Mantener juntos los trabajos activos del comprador encontrado y explicar en pantalla que los filtros seleccionan grupos completos; los totales globales no se reducen al paginar o buscar.

Los servicios comprados con adelanto incluido (`adelanto: "incluido"`) se buscan también con “adelanto” o “urgencia” y se muestran en una zona prioritaria separada en la agenda.

**Why:** El usuario indicó que los adelantos incluidos en el servicio deben encontrarse al buscarlos y que esos trabajos requieren una zona aparte.

**How to apply:** No confundirlos con el adelanto vendido como artículo separado (`adelanto: "solo"`); conserva el servicio como un solo trabajo con su marca de urgencia.

La prioridad de entrega requiere pago confirmado y se aplica antes de seleccionar la página de compradores. Un adelanto independiente no identifica qué servicio adelantar, ni siquiera si comparte comprador o pedido.

**Why:** La separación visual posterior a paginar ocultaba compradores urgentes; además mostraba rechazos como prioritarios. No existe una asociación explícita que permita atribuir un adelanto suelto a otro servicio.

**How to apply:** Mantener íntegros los grupos de compradores; no promover pendientes o rechazos por su marca de adelanto. Al entregar o devolver el servicio, recalcular la prioridad usando solo los servicios activos.
