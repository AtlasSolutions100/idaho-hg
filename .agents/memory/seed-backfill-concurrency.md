---
name: Seed backfill concurrency
description: Startup seed/backfill inserts into append-only tables need a Postgres advisory lock to stay idempotent.
---
Rule: any startup backfill that inserts into a table without a unique constraint (e.g. append-only rate history) must run inside a transaction that takes `pg_advisory_xact_lock` before its exists-check.

**Why:** parallel vitest test files (separate processes) each triggered the seed path and double-inserted a backfill row — an exists-check alone is racy across processes.

**How to apply:** when adding new seed/backfill entries for already-populated databases, follow the advisory-lock pattern in the rates route; plain `onConflictDoNothing` is fine only when a PK/unique constraint exists.
