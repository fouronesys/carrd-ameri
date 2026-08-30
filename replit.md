# Fresatanika

A dark-themed React+Vite clone of the Fresatanika Carrd page — a Spanish-language tarot/witchcraft services site with sections for Home, Hechizos, Lecturas, Aclaraciones, Métodos de Pago, and Mensualidad.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- Frontend: `artifacts/fresatanika` (React+Vite). Pages in `src/pages`, catalog/payment helpers in `src/lib`.
- API: `artifacts/api-server` (Express 5). Routes in `src/routes` (`health.ts`, `wompi.ts`), all mounted under `/api`.
- DB: `lib/db` (Drizzle + `pg`, node-postgres). Schema source in `lib/db/src/schema`.
- CapRover deploy: `Dockerfile`, `captain-definition`, `.dockerignore` at repo root; guide in `docs/CAPROVER.md`.

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
