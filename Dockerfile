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

CMD ["node", "server.js"]
