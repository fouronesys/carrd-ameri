---
name: Catalog and validation boundaries
description: Preserve the original Carrd catalog and protect shared live records while validating admin changes.
---

Preserve the original Carrd services and styling as the baseline. Integrate administrable services into their matching categories without destructively migrating or rewriting the original catalog.

**Why:** The user wants to retain the existing Node/Express Carrd site and its design, not replace it with a new frontend or lose original services.

**How to apply:** Include original services when reporting catalog totals. Make ordering semantics explicit within the chosen category; do not describe an administrable-only count as the full catalog.

Use isolated in-memory fixtures for tests that create services, change work status or trigger notifications.

**Why:** Development can point at the same external PostgreSQL used by CapRover, and the configured SMTP credentials can send real customer messages. A preview is not proof of data isolation.

**How to apply:** Do not mark real customer work as delivered or send test messages through configured SMTP. Validate mutating browser flows against a deliberately isolated test entrypoint.
