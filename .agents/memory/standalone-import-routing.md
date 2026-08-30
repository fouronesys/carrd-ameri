---
name: Standalone imports in artifact workspaces
description: Routing and working-directory constraints when a standalone root server is hosted by an artifact-owned workflow.
---

Artifact-owned development commands execute from the artifact directory, not the workspace root. A root-level standalone server therefore needs an explicit relative path from the artifact directory.

**Why:** A root server failed with `MODULE_NOT_FOUND` when invoked as though the workflow started at the workspace root. An older stopped API artifact also continued reserving `/api`, producing proxy 502 responses instead of allowing the root server to handle those endpoints.

**How to apply:** For standalone imports, point the web artifact command at the root entrypoint relative to the artifact directory. Move any obsolete artifact route away from paths owned by the imported server; stopping its process alone may not release proxy routing.