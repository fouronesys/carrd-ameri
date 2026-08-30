# Fresatanika

Tienda e-commerce en español de servicios espirituales.

## Overview
- **Stack:** Node.js / Express v5, JavaScript vanilla en el frontend.
- **HTML:** generado por concatenación de strings en `lib/templates.js`.
- **Correos:** `lib/mailer.js`.
- **Datos:** PostgreSQL (Neon) vía `pg` Pool, con una columna JSONB `data`.
- **Carrito y cuenta (frontend):** `assets/cart.js`.
- **Página principal:** `index.html`.

## Estética
- Todo el contenido de cara al cliente está en español.
- Estilo "dark mistic": fondo `#100109`, rosa `#F0A3C3`, vino `#7D3754`.

## User preferences
- **No usar emojis** en la interfaz (se ven raros y desentonan con la estética).
  Usar marcas tipográficas monocromas del tema (p. ej. `✦`, `✿`, `✓`) o
  marcadores hechos con CSS en lugar de emojis de color.
