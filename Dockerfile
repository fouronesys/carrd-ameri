# syntax=docker/dockerfile:1
# Single-container build for CapRover.
# The Express API server (artifacts/api-server) also serves the built
# frontend (artifacts/fresatanika) so the whole site runs from one container.

# ---------- Build stage ----------
FROM node:24-bookworm-slim AS builder
WORKDIR /app

# pnpm (pinned to match the committed lockfile)
RUN npm install -g pnpm@10.26.1

COPY . .
RUN pnpm install --frozen-lockfile

# Build the frontend (Vite) and the API server (esbuild).
# BASE_PATH=/ serves the site at the domain root; PORT is only needed because
# the build configs validate it at build time.
ENV NODE_ENV=production
ENV PORT=80
ENV BASE_PATH=/
RUN pnpm --filter @workspace/fresatanika run build \
 && pnpm --filter @workspace/api-server run build

# ---------- Runtime stage ----------
FROM node:24-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=80
ENV SERVE_STATIC_DIR=/app/public

# Bundled API server (esbuild output is self-contained) + built frontend assets.
COPY --from=builder /app/artifacts/api-server/dist ./dist
COPY --from=builder /app/artifacts/fresatanika/dist/public ./public

EXPOSE 80
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
