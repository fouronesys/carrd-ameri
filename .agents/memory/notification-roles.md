---
name: Notification roles
description: User-confirmed boundaries for staff notification emails and linked recipients.
---

Assistants receive operational notices only, without access/security alerts.
Administrators receive all internal notices. Support emails linked to existing
panel users and additional recipients without panel access.

**Why:** The user explicitly selected “Solo avisos operativos, sin alertas de
acceso” for assistants. Receiving email must not itself grant panel access.

**How to apply:** Apply the role boundary to new internal notification types as
well as existing ones. Keep customer state/evidence messages private rather than
automatically copying them to staff. Preserve the existing server-configured
primary recipient; removing a linked recipient is not permission to remove the
original destination.
