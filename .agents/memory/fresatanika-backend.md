---
name: Fresatanika backend
description: Environment quirks and deployment constraints for the Fresatanika Node/Express catalog+booking app.
---

# Fresatanika (Carrd-based catalog → Node/Express)

- **better-sqlite3 does NOT compile in this Replit environment** (native build fails). Use a JSON-file DB instead. **Why:** repeated build failures wasted time; the JSON store also satisfied the client's "un archivo" (a single file) requirement.

- **All persistent state lives under `DATA_DIR`** (bookings JSON, uploaded photos, session secret). In dev this defaults to a local `data/` dir; in the Dockerfile it is `/data`.

- **CapRover deploy requires a persistent volume mounted at `/data`.** **Why:** without it, every redeploy wipes all bookings, uploaded photos, and the session secret. This is the single most important deploy step and is easy to forget.

- **Secrets are required, not defaulted.** `ADMIN_PASSWORD` (admin panel at `/admin`) and `SMTP_PASS` (Zoho `admin@fourone.com.do`) must be set as env/secrets. The admin password fallback was intentionally removed so a missing env fails safe instead of exposing a predictable password.

- **Payment integrity:** `/api/booking` accepts a price only if it appears in the catalog (prices are parsed from `index.html` at startup). `/gracias/:ref` marks a booking as `agendado` ONLY when the Wompi tx is APPROVED **and** `reference`, `amount_in_cents` (== precio_cop*100), and `currency === 'COP'` all match exactly. Never loosen these checks.

- **Photo uploads are raster-only** (jpeg/png/webp; SVG blocked) and served with `X-Content-Type-Options: nosniff` + `Content-Security-Policy: default-src 'none'; sandbox` to prevent stored-XSS in the authenticated admin view.
