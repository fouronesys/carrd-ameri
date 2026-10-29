# Confirmación automática de Wompi en CapRover

## Causa corregida

La documentación actual de Wompi indica que consultar transacciones requiere
autenticación con **llave privada**. La aplicación consultaba sin ese encabezado
y trataba una respuesta HTTP fallida como si no hubiera confirmación, incluso
contestando `200` al webhook. Esto impedía que Wompi solicitara un reintento.
La causa concreta de un pago de producción debe contrastarse con sus registros:
no se han consultado ni modificado transacciones reales durante esta corrección.

## Configuración del servidor

En las variables de entorno de la aplicación **CapRover**, configurar:

| Variable | Uso |
| --- | --- |
| `WOMPI_PUBLIC_KEY` | Llave pública de la cuenta que recibe los pagos. |
| `WOMPI_PRIVATE_KEY` | Llave privada de esa misma cuenta y ambiente. Solo servidor. |
| `WOMPI_INTEGRITY_SECRET` | Firma de integridad del checkout; no sustituye la llave privada. |
| `WOMPI_EVENTS_SECRET` | Secreto de eventos, si está configurado en el servidor para validar firmas. Es distinto de los anteriores. |

Producción usa llaves `pub_prod_…` y `prv_prod_…`; sandbox usa
`pub_test_…` y `prv_test_…`. No mezclar ambientes ni cuentas. Guardar valores
sin comillas añadidas ni saltos de línea. Nunca incluir llaves privadas o secretos
en código, chat, capturas o archivos públicos.

**Agregar un secret en Replit no lo agrega a CapRover.** La variable debe existir
también en CapRover antes de desplegar la versión corregida. No es necesario
modificar la base de datos ni volver a crear los pedidos.

## Webhook

En el dashboard de Wompi, configurar el endpoint de eventos del ambiente correcto
con la URL HTTPS pública de esta aplicación en CapRover y la ruta
`/wompi/webhook`. Debe ser accesible sin inicio de sesión ni protección del proxy
que bloquee las peticiones de Wompi.

La aplicación vuelve a consultar la transacción con Wompi antes de confirmar.
Si hay secreto de eventos configurado, una firma inválida devuelve `401`.
Si falla la consulta al proveedor, devuelve `500` para permitir un reintento.
Un evento válido con pago todavía `PENDING` devuelve `200`, pero no lo confirma.

## Recuperación y comprobación

Al arrancar la aplicación se revisan los pagos Wompi pendientes; después, cada
15 minutos. Se consulta por referencia y se reverifica cada transacción por ID,
exigiendo referencia exacta, monto completo en centavos y moneda COP.
Los pedidos usan el total guardado del pedido, incluida la comisión, no el precio
de uno de sus servicios.

- Un resultado aprobado válido pasa a agendado sin requerir el regreso del comprador.
- Una confirmación repetida no vuelve a enviar los avisos ni vaciar el carrito.
- Una caída, un error de autenticación, una respuesta malformada, una aprobación
  con discrepancia o un pago todavía pendiente impiden la limpieza de ese ciclo.
- La consulta tiene un límite de 10 segundos, para que una conexión atascada no
  bloquee todas las revisiones siguientes.

Revisar los registros de CapRover después del despliegue:

| Evento `[wompi]` | Interpretación |
| --- | --- |
| `configuracion` | Ambiente y disponibilidad de las llaves, sin mostrar sus valores. |
| `falta_WOMPI_PRIVATE_KEY` | Falta configurar la llave privada en ese servidor. |
| `llaves_de_ambientes_distintos` | No coinciden los ambientes de llave pública y privada, o el formato privado es incorrecto. |
| `consulta_http` | Incluye estado HTTP: `401/403` requieren revisar llave/permisos; `404`, ID/cuenta/ambiente; `429`, límite del proveedor; `5xx`, disponibilidad. |
| `consulta_timeout` / `consulta_red` | Fallo de conexión; se reintentará sin borrar el registro. |
| `webhook_recibido` / `webhook_procesado` | Llegó el evento y se indica su resultado. |
| `webhook_firma_invalida` | Revisar el secreto de eventos correspondiente al ambiente. |
| `webhook_reintentable` | No pudo verificarse; se respondió `500`. |
| `pago_no_coincide` | Indica qué comprobación falló, sin publicar importes o datos del cliente. No aprobar a ciegas. |
| `pago_confirmado` | Confirmación validada y guardada. |
| `reconciliacion_finalizada` | Totales recuperados/rechazados y si hubo resultados sin resolver. |

Los logs omiten llaves, encabezados, cuerpos de respuesta y datos personales.
Para investigar un caso, comprobar en privado referencia, ID y total en Wompi
y contrastarlos con el registro del pedido; no cambiar las reglas de validación
para hacer que una transacción ajena coincida.

## Validación aislada

Las pruebas usan llaves sintéticas, respuestas Wompi simuladas, correo simulado
y, para la transición SQL concurrente, PostgreSQL local desechable.
No realizan pagos, no llaman a Wompi real y no modifican la base de producción.

Fuentes oficiales consultadas el 28 de octubre de 2026:

- https://docs.wompi.co/docs/colombia/transacciones/
- https://docs.wompi.co/docs/colombia/seguimiento-de-transacciones/
- https://docs.wompi.co/docs/colombia/eventos/
