---
name: Clerk email-code testing
description: How to e2e-test Clerk email one-time-code sign-in without real emails
---

- Emails containing `+clerk_test` (e.g. `jane+clerk_test@example.com`) receive no real mail on dev instances; the verification code is always **424242**. Works in both the app UI and raw FAPI calls.
- Fully scriptable FAPI flow: `POST /v1/dev_browser` (get `token`) → `POST /v1/client/sign_ins?__clerk_db_jwt=<token>` with `identifier` → `prepare_first_factor` (`strategy=email_code`, `email_address_id` from `supported_first_factors`) → `attempt_first_factor` with `code=424242` → `POST /v1/client/sessions/<id>/tokens` for a Bearer JWT usable against the API server.
- **Why:** lets curl and the testing subagent verify session→employee mapping, spoofed-id override, and 403 paths without inbox access.
- **How to apply:** any test of the employee mobile sign-in or session-scoped API endpoints; clean up seeded roster rows and reset changed emails after.
