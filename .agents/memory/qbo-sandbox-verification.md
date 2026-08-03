---
name: QuickBooks sandbox verification
description: Lessons from connecting the app to an Intuit sandbox and verifying invoice sends live
---

- Live send verified (Aug 2026) against "Sandbox Company US b391": lines, qty, rates, service dates, totals all matched exactly; second send reused the same customer/item IDs — no duplicates. No QBO rounding or name-length surprises with `Last, First ROLE` item names or fractional qty/rates (42.5 mi @ 0.655).
- **Intuit dashboard bug:** Redirect URI saves can fail silently — the URI shows in the list but OAuth still rejects it. Fix: hard-refresh, delete/re-add/save, wait ~5 min. Users may need 2–3 save attempts.
- **State-mismatch trap:** each hit to the connect route overwrites the state cookie; approving an older Intuit consent tab then fails with "state mismatch" and a silent redirect to `?quickbooks=error`. Tell users: one fresh tab, approve immediately.
- Sandbox mode = `QBO_ENV=sandbox` (set in the development environment). Development Intuit keys only work with sandbox companies; going live needs Production keys + the production redirect URI registered + `QBO_ENV` unset.
- To inspect QBO data directly, bundle a one-off script with the api-server's esbuild (`--banner:js` createRequire shim, `--external:pino*`) and run from the artifact dir so workspace deps resolve.
