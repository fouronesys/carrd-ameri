---
name: Delivery notification guarantees
description: SMTP confirmation limits and the choice of delivery guarantees across process crashes.
---

Delivery notices must favor recovery over silently losing a message. Do not
claim that ordinary SMTP can provide exactly-once delivery across process death.

**Why:** SMTP acceptance and a PostgreSQL commit cannot participate in the same
atomic transaction. A crash between them leaves an ambiguous result. A stable
Message-ID can help receivers deduplicate, but does not guarantee they will.

**How to apply:** Preserve the at-least-once guarantee and disclose the narrow
duplicate window. A requirement to eliminate even that window needs an email
provider with server-side idempotency, not a pre-send success flag.
