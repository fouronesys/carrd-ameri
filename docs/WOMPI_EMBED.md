# Pasarela Wompi reutilizable

Esta pasarela está pensada para que **otras amigas / Carrds** acepten pagos con Wompi sin tener que programar nada. Cada link de pago va firmado con HMAC, así que **nadie puede modificar el monto en la URL**.

## Para la dueña del Carrd: cómo obtener tu link

1. Abre el **Generador de links** en el sitio principal:
   ```
   https://TU_DOMINIO/#generador
   ```
2. Llena el formulario:
   - **Nombre del servicio** — ej: "Lectura de tarot completa"
   - **Precio en COP** — ej: `58000` (sin puntos)
   - **Identificador de tu sitio** *(opcional)* — ej: `tarot-mariana`. Aparece como prefijo en la referencia de Wompi para que distingas qué Carrd originó el pago.
   - **URL de retorno** *(opcional)* — a dónde vuelve el cliente después de pagar (ej: `https://tarot-mariana.carrd.co/?pago=ok`)
3. Pulsa **Generar link ♡**.
4. Copia el link y pégalo en un botón de tu Carrd.

Cada link es para **un servicio con un precio fijo**. Si vendes 5 cosas, genera 5 links distintos.

## Cómo se ve un link generado

```
https://TU_DOMINIO/api/wompi/pay/eyJhIjo1ODAwMCwiaSI6IkxlY3R1cmEifQ.k7nP3...
```

El token después de `/pay/` contiene el monto + nombre del servicio + firma HMAC. Si alguien lo modifica, el servidor lo rechaza con "Link de pago inválido".

## Embeber en Carrd

1. En el editor de Carrd, añade un elemento **Button**.
2. En "URL" pega el link de pago.
3. Cambia el texto del botón a algo como "Pagar ♡ $58.000".
4. Marca "Open in new tab" si prefieres que el checkout abra en otra pestaña.
5. Repite para cada servicio.

Si tu Carrd permite **Embed → HTML**, también puedes pegar:

```html
<a href="https://TU_DOMINIO/api/wompi/pay/<TU_TOKEN>"
   style="display:inline-block;background:#7a2a4a;color:#f0d0db;border:1px solid #9e4466;padding:8px 18px;font-family:'Courier New',monospace;text-decoration:none;border-radius:2px;">
  Pagar ♡ COP $58.000
</a>
```

## Para desarrolladores: API directa

Si quieres integrarlo en una app custom:

### Generar un link de pago (POST)

```
POST /api/payment-links/create
Content-Type: application/json

{
  "amountCop": 58000,
  "itemName": "Lectura de tarot",
  "site": "tarot-mariana",          // opcional
  "returnUrl": "https://..."        // opcional
}
```

Respuesta:
```json
{
  "payUrl": "https://TU_DOMINIO/api/wompi/pay/<token>",
  "token": "<token>"
}
```

### Redirigir al checkout (GET — público)

```
GET /api/wompi/pay/:token   → 302 → checkout.wompi.co
```

Cualquiera con el token puede pagar; nadie puede alterar el monto sin invalidar la firma.

CORS está abierto a `*` para que se pueda llamar desde cualquier dominio.

## Pruebas

Mientras las llaves sean `pub_test_...` y `test_integrity_...`, puedes ejecutar pagos completos sin movimientos reales. Wompi acepta tarjetas de prueba documentadas en https://docs.wompi.co/docs/colombia/ambiente-de-pruebas/.

## Seguridad

- La llave **pública** de Wompi se incluye en cada URL de checkout (está pensada para eso).
- La llave de **integridad** **nunca** sale del servidor — se usa para:
  1. Firmar la transacción ante Wompi (SHA-256).
  2. Derivar la clave HMAC que protege los links de pago.
- Si alguien intenta modificar `amount`, `item` o cualquier parte del token, la firma deja de coincidir y el endpoint responde "Link de pago inválido".
