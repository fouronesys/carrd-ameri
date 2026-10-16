# Regresión de catálogo y compra

Desde la raíz del proyecto:

```sh
npm run test:contratos
```

También se incluye en `npm test`, junto con las otras pruebas del proyecto.
Una aserción fallida devuelve un código de salida distinto de cero; no se
requieren cuentas, credenciales de pagos ni configuración SMTP.

## Requisitos

- Node.js 20 o posterior y las dependencias de desarrollo instaladas
  (`pnpm install --frozen-lockfile` en este workspace).
- PostgreSQL local con `initdb` y `pg_ctl` disponibles en `PATH`.
  Ejecutar como usuario normal, no como root (requisito de `initdb`).
- Puertos locales libres, asignados automáticamente.

El comando falla explícitamente si falta PostgreSQL local. **Nunca utiliza
`POSTGRES_URL`, `DATABASE_URL`, SMTP ni claves Wompi del entorno del proyecto.**
No se debe ejecutar el archivo de prueba con conexiones configuradas a mano.

## Aislamiento

`scripts/test-contratos.cjs` crea un clúster PostgreSQL nuevo en un directorio
temporal y ejecuta las pruebas en un proceso que solo recibe una lista mínima de
variables y valores sintéticos. La inicialización usa una carpeta de datos vacía,
sin importar archivos de `data/`. En `finally` detiene PostgreSQL y elimina tanto
la base como los archivos temporales, también cuando hay aserciones fallidas.
SIGINT/SIGTERM se propagan al proceso de pruebas para realizar esa limpieza;
como con cualquier proceso, SIGKILL no permite ejecutar `finally`.

Las rutas reales de `server.js` usan `lib/db.js` y PostgreSQL real. Únicamente
las sesiones usan memoria. Todos los métodos de correo se sustituyen por una
barrera que registra cualquier intento y hace fallar la comprobación final.
No se inicia el servidor principal ni sus tareas programadas.
Las llamadas de red de la aplicación están limitadas al servidor HTTP temporal.

`tests/helpers/navegador-compra.cjs` ejecuta **los archivos completos originales**
`assets/wompi.js` y `assets/cart.js` en un DOM con LinkeDOM y `node:vm`.
Acciona botones y formularios; envía su `FormData` real al servidor temporal.
Las redirecciones se capturan como texto: no se abre Wompi ni se aprueba ningún
pago. No es una prueba visual de CSS ni un navegador completo.

## Cobertura

- Todos los artículos estáticos de `index.html`: hechizos, lecturas, extras y
  paquetes Silver/Gold/Platinum; incluye nombres repetidos con precios distintos.
- Servicios administrables de los tipos admitidos (hechizo y lectura), con
  nombres decorados, caracteres HTML y más de 60 caracteres.
- Identificadores, nombres y precios COP/USD conservados al añadir al carrito,
  comprar individualmente y enviar pedidos en lotes de hasta 20 artículos.
- Total autoritativo, comisión Wompi aplicada una vez por pedido, firma de
  integridad y monto en centavos de las redirecciones.
- Promoción por fecha y código: solo para hechizos reales; gana el mayor
  descuento, no la suma. Se prueba también la aplicación del código desde el
  formulario original.
- Rechazo de nombres, identificadores y precios manipulados, lectura disfrazada
  de extra/hechizo y uso indebido de las banderas de adelanto. Las banderas que
  el servidor ignora no cambian el tipo ni el precio autorizado.
- Adelanto independiente a precio fijo y recargo después del descuento.
- Servicio oculto, eliminado o con precio modificado: una compra obsoleta falla;
  la compra con el nuevo precio funciona. Un lote rechazado no guarda compras
  parciales.

Estas pruebas verifican la creación de compras pendientes; no sustituyen las
pruebas de confirmación de pagos, webhooks ni el procesamiento de correos.
