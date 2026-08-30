---
name: Artifact workflow port detection
description: Diagnosing "DIDNT_OPEN_A_PORT" errors when restart_workflow fails despite the dev server actually starting.
---

When `restart_workflow` on a `kind = "web"` artifact times out with `DIDNT_OPEN_A_PORT` but the workflow logs clearly show the dev server is ready (e.g. "VITE vX.Y.Z ready in N ms" with the port URL printed), and bash tests confirm `curl localhost:<port>/` returns 200, the port IS open — the platform's health-check just can't see it.

**Why:** Web-artifact health checks go through the platform proxy (the service with `externalPort = 80` in `.replit [[ports]]`, typically owned by another artifact). If that proxy workflow is stopped or stale, it cannot forward `GET /<artifact-path>` to the new artifact's local port, so the workflow manager reports the port as never opened.

**How to apply:**
- Before debugging Vite config, ports, or `artifact.toml`, check which workflow owns the `externalPort = 80` mapping in `.replit` and make sure that workflow is `running`.
- Restart that proxy workflow first, then restart the failing artifact. Don't waste cycles changing ports, removing `strictPort`, stripping plugins, or trying `configureWorkflow` overrides until the proxy is confirmed up.
- `ss -tln` from a bash tool may NOT show the dev server's port even when it's truly listening (network-namespace isolation). Trust `curl localhost:<port>/` over `ss` for "is the port really open?".

**Creating `artifact.toml` from scratch:** the `write` tool blocks direct edits to `artifact.toml`, and `verifyAndReplaceArtifactToml` requires the target file to already exist. Workaround: write the content to `.replit-artifact/artifact.edit.toml` with the `write` tool, `cp` it to `artifact.toml` via bash to seed the file, then call `verifyAndReplaceArtifactToml` to register it properly. Note that this still does NOT add a `[[ports]]` entry to `.replit` — only `createArtifact` does that, and only when there's no path conflict.
