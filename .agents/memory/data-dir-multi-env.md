---
name: Data directory across environments
description: The same DATA_DIR secret is used in CapRover and Replit, but /data may not exist in the Replit runtime.
---

The application should prefer the configured DATA_DIR and use it when the path is available. If the configured value is `/data` but that mount cannot be created in the development runtime, use the project-local data directory for that runtime only.

**Why:** CapRover persists uploads and legacy JSON backups through the `/data` volume, while the Replit container may not provide that mount. Treating `/data` as mandatory prevents the app from starting in development even when PostgreSQL is healthy.

**How to apply:** Keep the CapRover secret unchanged. Make the directory resolver detect the unavailable `/data` mount and fall back locally without weakening the production volume behavior.