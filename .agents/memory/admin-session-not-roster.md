---
name: Admin session is not a roster employee
description: Employee-scoped API routes reject requests made under the admin's Clerk session
---

The admin's Clerk session email (ADMIN_EMAIL) does not correspond to a roster employee row. Any route that resolves the signed-in session to a roster employee (e.g. creating time entries) returns 403 when called as the admin.

**Why:** session→employee resolution pins actions to the caller's own roster row; the admin has none.

**How to apply:** in e2e tests, clear the mocked session (email = null → unauthenticated path) before hitting employee-scoped endpoints, and only set the admin email for requireAdmin routes. In app code, admin surfaces must use admin-specific endpoints rather than employee-scoped ones.
