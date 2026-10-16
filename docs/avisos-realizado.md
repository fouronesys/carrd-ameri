# Avisos de trabajo realizado

Al marcar un trabajo como realizado, `lib/db.js` confirma el cambio y la entrada
en `avisos_realizado` en una sola transacción. El HTTP espera únicamente esa
escritura, no el servidor de correo. No se crean avisos para invitados ni se
reinician las marcas de avisos enviados antes de introducir esta cola.

`lib/avisos-realizado.js` consulta la cola al arrancar y cada cinco segundos.
Cada instancia procesa hasta veinte avisos por vuelta, uno a uno.
`FOR UPDATE SKIP LOCKED` mantiene un bloqueo de fila durante el envío SMTP y la
confirmación SQL: otras instancias pueden procesar otras filas, nunca la misma
simultáneamente. Si se cierra o mata el proceso, PostgreSQL revierte la
transacción y libera el aviso para otra instancia. No hace falta recuperar
manualmente un estado «en proceso» ni esperar un vencimiento de lease.

Solo después de la aceptación SMTP se guardan juntos la marca
`cliente_aviso_realizado` y el estado `enviado`. Los errores, la ausencia de
configuración SMTP y los destinatarios no aceptados dejan el aviso pendiente.
Los reintentos tienen espera exponencial desde 30 segundos hasta seis horas,
sin descartar mensajes por alcanzar un máximo de intentos.
Los trabajos desmarcados se posponen; los borrados se cancelan.
El apagado ordenado deja de reclamar y espera el envío activo antes de cerrar
PostgreSQL; un apagado forzado deja el aviso recuperable.

## Límite de SMTP

Esto ofrece entrega **al menos una vez**, no exactamente una vez. Si SMTP acepta
un mensaje y el proceso muere antes del `COMMIT`, el siguiente intento podría
repetirlo. Se reutiliza un `Message-ID` estable para el mismo trabajo, pero el
receptor no está obligado a deduplicarlo. Evitar incluso ese caso exige un
proveedor de envío con una clave de idempotencia reconocida por su API.
«Aceptado» tampoco garantiza entrega en la bandeja del destinatario.

Cada envío ocupa una conexión de PostgreSQL y una transacción mientras espera
SMTP. El transporte tiene límites de conexión/saludo de 10 segundos y de
inactividad de socket de 30 segundos. Un límite de transacción impuesto por el
proveedor de PostgreSQL puede provocar reintentos y debe permitir esa espera.

## Validación aislada

`npm test` ejecuta las pruebas existentes y `tests/avisos-realizado.test.cjs`.
Esta última requiere los binarios `initdb` y `pg_ctl` de PostgreSQL, levanta un
clúster temporal local y un servidor SMTP simulado en puertos libres. No utiliza
las conexiones PostgreSQL ni SMTP del proyecto y solo usa direcciones
`example.invalid`. Comprueba transacción atómica, reclamaciones concurrentes,
recuperación tras `SIGKILL`, reintentos y marcas posteriores a la aceptación.
