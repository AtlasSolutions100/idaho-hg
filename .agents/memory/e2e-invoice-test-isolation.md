---
name: E2E invoice test isolation
description: How invoice/report e2e test files avoid interfering with each other on the shared database
---
Invoice/report e2e test files all hit the same live database and run concurrently, so each file must claim its OWN billing-period month (e.g. one file uses 2026-03, another 2026-06, another 2026-04). Reusing a month + client already used by another e2e file makes assertions like `missingRateCount === 0` flaky depending on run order.

**Why:** a new e2e file reused June 2026 for the same seeded clients as an existing file and randomly broke both files' counts.

Also: seeding-vs-demo race — any e2e file that inserts legacy demo employee IDs ("1"–"6") can make a concurrently-running file's `ensureRosterSeeded` take the demo-purge branch. That branch must still run the idempotent client backfills (never early-return before them), or other files randomly lose Current PT/Thrive from `/clients`.

**How to apply:** when adding an e2e report/invoice test file, grep existing `*.e2e.test.ts` for the date constants and pick an unused month. Also: employee-rate lookups fall back to the earliest history row, so "no rate on file" can only be simulated with an employee that has ZERO rate rows — insert directly into employeesTable, since POST /employees always creates a rate row.
