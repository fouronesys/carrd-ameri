# Desplegar Fresatanika en CapRover

Todo el sitio (página web + API + pasarela Wompi) corre en **un solo contenedor**.
El servidor Express sirve el frontend ya compilado y atiende las rutas `/api`.

## Archivos de despliegue (ya incluidos)

- `Dockerfile` — compila el frontend (Vite) y la API (esbuild) y deja todo listo para correr.
- `captain-definition` — le dice a CapRover que use el `Dockerfile`.
- `.dockerignore` — evita copiar archivos innecesarios.

## Pasos

1. **Crea la app en CapRover**
   - En el panel de CapRover: *Apps → crea una nueva app* (por ejemplo `fresatanika`).
   - Marca **Has Persistent Data** solo si lo necesitas (no hace falta).

2. **Configura las variables de entorno** (pestaña *App Configs → Environmental Variables*):

   | Variable | Para qué sirve | Ejemplo |
   |----------|----------------|---------|
   | `DATABASE_URL` | Conexión a PostgreSQL | `postgres://usuario:clave@host:5432/basedatos` |
   | `SESSION_SECRET` | Clave secreta de sesión | una cadena larga aleatoria |
   | `WOMPI_PUBLIC_KEY` | Llave pública de Wompi | `pub_prod_...` (o `pub_test_...` para pruebas) |
   | `WOMPI_INTEGRITY_SECRET` | Llave de integridad de Wompi | `prod_integrity_...` |
   | `PUBLIC_ORIGIN` | Dominio público del sitio (para los links de pago) | `https://fresatanika.tudominio.com` |

   > `PUBLIC_ORIGIN` debe ser la URL final con `https://` y **sin** barra al final.
   > Si no la pones, el sistema intenta deducir el dominio automáticamente.

3. **El puerto del contenedor**
   - La app escucha en el puerto **80** dentro del contenedor (ya configurado).
   - En *App Configs → Container HTTP Port* deja **80** (es el valor por defecto de CapRover).

4. **Despliega el código**

   Opción A — desde tu computadora con la CLI de CapRover:
   ```bash
   npm install -g caprover
   caprover deploy
   ```

   Opción B — conecta el repositorio de GitHub en la pestaña *Deployment* de la app
   y CapRover construirá automáticamente con cada push.

5. **Activa HTTPS**
   - En la pestaña *HTTP Settings* habilita tu dominio y activa **HTTPS** (Let's Encrypt).
   - Recuerda que `PUBLIC_ORIGIN` debe coincidir con ese dominio.

## Base de datos

Necesitas un PostgreSQL accesible (puede ser otra app de CapRover o un servicio externo).
Antes del primer uso, aplica el esquema con:

```bash
DATABASE_URL="postgres://..." pnpm --filter @workspace/db run push
```

## Notas

- El frontend llama a la API por rutas relativas (`/api/...`), mismo dominio, así que no
  hace falta configurar CORS ni un proxy aparte.
- Las llaves `WOMPI_PUBLIC_KEY` y `WOMPI_INTEGRITY_SECRET` deben ser del **mismo** comercio
  Wompi (las de prueba juntas, o las de producción juntas).
- Para verificar que la app está viva, CapRover puede usar la ruta `/api/healthz`.
