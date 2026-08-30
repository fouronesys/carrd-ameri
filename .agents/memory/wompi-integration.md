---
name: Wompi integration gotchas
description: Non-obvious traps when wiring Wompi checkout + secrets in this repo
---

# Wompi integration gotchas

## Key/secret slotting is easy to swap
When the user pastes Wompi keys, they may land in the wrong secret slot. Validate by inspecting the generated checkout URL:
- `WOMPI_PUBLIC_KEY` must hold the value starting with `pub_test_` / `pub_prod_` (it appears as `public-key=` in the checkout URL).
- `WOMPI_INTEGRITY_SECRET` must hold the value starting with `test_integrity_` / `prod_integrity_` and must NEVER appear in any URL.
**How to apply:** after secrets change, curl a pay endpoint and grep the 302 `Location`. If `public-key=` starts with `test_integrity_`/`prod_integrity_`, they're swapped — tell the user to swap them in the Secrets pane.

## Secrets must go through requestEnvVar, not setEnvVars
`setEnvVars` is only for non-secret env vars. Calling it with secret values appeared to work (endpoint returned a real checkout URL) but the values did NOT persist — a workflow restart wiped them and `viewEnvVars({type:"secret"})` showed them as `false`.
**Why:** secrets live in a separate store; only `requestEnvVar({requestType:"secret"})` (user-confirmed) persists them.
**How to apply:** never store API keys/secrets via setEnvVars; always request via requestEnvVar and restart the consuming workflow afterward.

## Signature formula
Checkout integrity hash = `sha256(reference + amountInCents + currency + integritySecret)`. amountInCents = COP * 100. currency = "COP".

## Reusable payment links (HMAC)
External Carrd sites get tamper-proof links via `POST /api/payment-links/create` → token = `base64url(payload).base64url(hmac)`, verified at `GET /api/wompi/pay/:token`. HMAC key is derived from the integrity secret (`sha256("payment-link:"+secret)`) so no extra secret is needed. Editing amount/item in the URL invalidates the signature.
