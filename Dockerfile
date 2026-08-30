FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --registry https://registry.npmjs.org

COPY . .

ENV NODE_ENV=production
ENV PORT=80
ENV DATA_DIR=/data

EXPOSE 80

# Health check para actualizaciones sin downtime (rolling update en Docker Swarm/
# CapRover): el orquestador espera a que la nueva instancia responda "healthy" en
# /healthz (conexión a PostgreSQL viva) antes de retirar la instancia anterior.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||80)+'/healthz',function(r){process.exit(r.statusCode===200?0:1)}).on('error',function(){process.exit(1)})"

# En cada despliegue: primero concilia los pagos Wompi pendientes (agenda los que
# ya fueron aprobados pero se quedaron sin confirmar) y LUEGO arranca el servidor.
# Se encadena con ';' a propósito: si la conciliación falla (p. ej. una caída
# pasajera de Wompi), NO se aborta el despliegue; el servidor arranca igual y su
# tarea periódica de reconciliación (cada 15 min) reintentará. Se usa 'exec' para
# que node reciba las señales (SIGTERM) y el apagado ordenado funcione.
CMD ["sh", "-c", "node scripts/conciliar-pendientes.js; exec node server.js"]
