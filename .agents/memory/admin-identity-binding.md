---
name: Admin identity binding
description: How admin (Molly) authorization must be established in this project
---

Admin authorization is decided by comparing the Clerk-verified session email against the server-configured `ADMIN_EMAIL` env var, failing closed when unset.

**Why:** roster rows (including emails) are mutable through still-unauthenticated API routes, so any row-based admin flag or roster-email match is a privilege-escalation path — an attacker can plant their own email on the admin row and pass the check. A completion review rejected exactly that design.

**How to apply:** when locking down further admin routes (payroll approval, roster edits, feedback), reuse the config-bound `requireAdmin` middleware; never derive admin status from database rows the API can modify, and keep an e2e regression that roster-email tampering does not grant access.
