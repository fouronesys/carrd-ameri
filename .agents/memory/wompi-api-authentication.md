---
name: Autenticación de consultas Wompi
description: Cambio externo de Wompi que exige llave privada para consultar transacciones y separa errores de ausencia de pago.
---

Las consultas de transacciones Wompi necesitan la llave privada de la misma cuenta
y ambiente; la llave pública, el secreto de integridad y el de eventos no la
sustituyen. No introducir un fallback de consultas sin autenticación.

**Why:** la documentación oficial consultada el 2026-10-28 anuncia que las
consultas por ID ya no admiten acceso anónimo ni llave pública. Un fallo de
autenticación no significa que el pago no exista; reconocer el webhook como
procesado en ese caso impide los reintentos y deja pedidos pendientes.

**How to apply:** verificar esta exigencia al cambiar la integración; mantener
secretos solo en servidor, no rebajar validaciones de referencia/monto/moneda y
conservar registros cuando la respuesta del proveedor es desconocida. La app se
publica en CapRover: los secrets guardados en Replit no configuran ese servidor.

Fuentes: https://docs.wompi.co/docs/colombia/transacciones/ y
https://docs.wompi.co/docs/colombia/seguimiento-de-transacciones/
