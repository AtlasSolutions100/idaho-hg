---
name: QBO e2e mocking
description: How to e2e-test QuickBooks send flows without Intuit credentials
---

The send-to-QuickBooks flow can be e2e-tested with the real HTTP stack and database by partially mocking two modules with `vi.mock(..., importOriginal)` before importing the app: the connection module's `getValidAccess` (return a fake token/realm) and the invoice module's `findOrCreateCustomer` / `findOrCreateItem` / `createQboInvoice` (return fake refs/ids, with a small delay to make race tests realistic).

**Why:** No Intuit sandbox in CI; mocking only the network wrappers keeps validation, duplicate-guard, advisory locking, and DB recording real.

**How to apply:** Any new test of the QBO send path — mock at the module boundary, never stub global fetch (the test's own HTTP calls use it).
