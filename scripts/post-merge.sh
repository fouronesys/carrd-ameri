#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Non-interactive and reproducible; never push the legacy Drizzle schema to
# the externally managed Fresatanika database. The app runs its own additive,
# advisory-lock-protected schema setup on startup during workflow reconciliation.
CI=true pnpm install --frozen-lockfile --prefer-offline
# Cada suite PostgreSQL crea un clúster aislado. Acotar concurrencia evita
# saturar el entorno compartido sin omitir ninguna prueba.
node --test --test-concurrency=2 tests/*.test.cjs
