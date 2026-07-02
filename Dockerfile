FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --registry https://registry.npmjs.org

COPY . .

ENV NODE_ENV=production
ENV PORT=80
ENV DATA_DIR=/data

EXPOSE 80

CMD ["node", "server.js"]
