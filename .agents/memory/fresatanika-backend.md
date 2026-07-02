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

- **CSRF on admin POST routes uses Origin/Referer validation** (a `mismoOrigen` middleware), not a token library. **Why:** the whole UI is plain HTML built via string concatenation in `lib/templates.js`, so per-form hidden-token plumbing is heavy; combined with the `SameSite=Lax` session cookie, Origin/Referer matching is sufficient defense for the destructive actions. **How to apply:** any new state-changing admin POST must be guarded by `mismoOrigen` (and `requiereAdmin`).

- **Any new uploaded-file field must also be threaded through the delete/cleanup path** in `lib/db.js` (`eliminarAdjuntos`, used by both `eliminarPorRef` and `eliminarPendientesAntiguos`), or the file becomes an orphan on disk. **Why:** `comprobante` was added everywhere except deletion, leaving sensitive payment-proof files behind after admin deletes a booking. **How to apply:** every field that stores an uploaded filename must be unlinked when its record is removed.

- **Scheduled reminders run in-process via `setInterval` in the `app.listen` callback** (like `limpiarPendientes`), guarded by an in-process boolean flag to avoid overlap on slow SMTP. Follow-up emails (5 semanas / 4 meses after `trabajo_hecho_en`) go to the ADMIN inbox (`NOTIFY_TO`/`SMTP_USER`), not the client — contacto is usually a social handle, not an email. **Why:** no external cron/queue in this CapRover setup. **How to apply:** persist a per-record "sent" timestamp (e.g. `seguimiento_5s_en`) set only after `r.enviado`, so a resend never fires; these internal tracking flags are the EXCEPTION to the six-place threading rule below — they are NOT rendered in any view/export.

- **A new booking field must be threaded through SIX places or it silently diverges:** frontend modal (`assets/wompi.js`: input + FormData append + validation), `/api/booking` (`server.js`: parse/validate/store), and four views/outputs in the two lib files — `paginaGracias` (customer confirmation page), `correoNotificacion` (email), `adminDashboard` (table header + `<td>`) in `lib/templates.js`, plus BOTH `generarExcel` and `generarPDF` in `lib/exportar.js` (each is a separate hand-built layout with its own column count + width array). **Why:** review repeatedly caught the PDF and the confirmation page being missed. `lib/templates.js` has 3 distinct views that all render booking data — don't confuse the email block with the confirmation page.
