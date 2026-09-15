# Idaho Healthcare Staffing (Hodge Staffing Time App)

Time-entry and payroll-approval app for Molly Hodge's healthcare staffing company, Idaho Healthcare Staffing: employees log hours on mobile, Molly approves payroll and manages rates from an admin dashboard.

## Run & Operate

- In Replit, use the **Hodge Staffing Time App** preview at `/`. Its managed services are `artifacts/staffing-app: web` and `artifacts/api-server: API Server`; they start automatically after dependencies or environment settings change.
- For local development outside Replit, start the API and web app together with `node dev-local.mjs` after providing a Postgres `DATABASE_URL`.
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Replit-managed Clerk provisions `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, and `VITE_CLERK_PUBLISHABLE_KEY` for authentication; do not set these manually.

## Stack

- pnpm workspaces, Node.js 24+, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Auth: Clerk (`@clerk/express` on the server, `@clerk/react` in the web app)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/staffing-app/` — the web app (served at `/`); pages in `src/pages/`, theme in `src/index.css`
- `artifacts/employee-mobile/` — the Expo/React Native employee app
- `lib/api-spec/openapi.yaml` — the API contract; everything under `lib/api-zod/` and `lib/api-client-react/` is generated from it, never hand-edited
- `lib/db/src/schema/` — DB schema, one file per area (roster, rates, time-entries, visit-types, disciplines, onboarding, qbo, …)
- `artifacts/api-server/src/routes/` — route handlers, Zod-validated
- `artifacts/api-server/src/lib/employee-auth.ts` — every authorization decision in the app

## Authorization — read this before touching a route

Everything is real data now: real people, real hours, real pay. There is no
anonymous access to anything that is not a plain label.

- `requireAdmin` — Molly only. Compares the Clerk-verified session email to the
  `ADMIN_EMAIL` environment variable, and fails closed when it isn't set. Admin
  identity is deliberately NOT a roster column: roster emails are editable
  through the API, so a row-based flag would let anyone promote themselves.
- `requireEmployee` — a signed-in email that maps to an active roster profile.
- `requireSignedIn` — any Clerk session; used where the caller may not be linked
  to a profile yet (the mobile claim-your-name flow, `GET /clients`).
- `resolveCaller` — for the endpoints Molly and employees share (time entries).
  It returns Molly, or the employee, or a ready-made 401/403 — it has no
  "anonymous" arm, so that case cannot be forgotten. Employees are always pinned
  to their own `employeeId`, whatever the request body says; only Molly may file
  or read hours across the roster. Drafts are private to their author.
- Public on purpose, and only these: `GET /visit-types`, `GET /disciplines`
  (label catalogues the sign-in and claim screens need), `POST /feedback`, and
  `GET /api/qbo/callback` (Intuit redirects a browser there with no app session;
  it is secured by the signed `state` cookie instead).

If you add an endpoint that touches a person, a rate, or an hour, gate it. The
regression net is `artifacts/api-server/src/routes/time-entries-access.e2e.test.ts`.

## Architecture decisions

- Time-entry names (employee/client) are denormalized onto rows at submit time so the approval table needs no joins.
- Rates are append-only and effective-dated: a correction is a new row with an effective date, never an edit of an old one, so already-paid periods keep the numbers they were paid at.
- `quantity` on a time entry means visits for a per-visit type and 15-minute blocks for an increment-billed one (Hospital at Home, Drive Time). It defaults to 1, so every pre-existing row prices exactly as before.
- **An increment-billed type is priced BY THE HOUR, not per block.** Molly's master sheet rates Hospital at Home at $84 bill / $67.20 pay for an RN — the same figure as "Non-visit doc/Mtg" — and her reconciliation sheets put fractional hours (1.5, 0.5) against it. `incrementMinutes` is only how finely employees log time. Never multiply the rate by `quantity` directly: go through `billableUnits()` in `lib/payroll-calc.ts`, which converts blocks to hours first. Doing it the other way bills four times the right amount, which is the bug that shipped in 83e1dcb. Molly confirmed this 2026-09-15.
- Drive Time (St. Luke's) is billed and paid at the **Hospital at Home rate** for every discipline — $84/$67.20 nursing, $94/$75.20 therapies — only on Hospital at Home or hospice work, as its own invoice line, with mileage billed on top. An early seed paid it $33.60, lifted from a leftover in her sample payroll sheet; `backfillDriveTimePayRate()` in `routes/rates.ts` corrects that row once.
- Staff mileage is **$0.65/mi** for every employee (the $0.69 on the rate sheet was what Molly paid herself and Adrian before she had staff). Client mileage billing follows the GSA rate and changes with it. `backfillStaffMileageRate()` moved every employee to $0.65 once, as a new history row effective the first day of the pay period open when it ran — never a period already paid.
- **Non-visit and hospice are hourly too**, in the same 15-minute steps as Hospital at Home (Molly's PT payroll sample pays 0.25 hr as $18.80; invoice 1189 bills 5.5 hrs of "NV/H@H" at $84). `backfillHourlyNonVisitAndHospice()` in `lib/visit-types.ts` flipped them once and multiplied the `quantity` on entries already filed against them by 4, so every existing entry keeps the exact dollar amount it had. Training is still per-visit — Molly hasn't said.
- Pay periods are two weeks, Sunday to Saturday, time and mileage due the closing Saturday, payday the Friday after — `payPeriodContaining()` in `lib/work-calendar.ts`, anchored on Molly's own calendar.
- Visit types carry an optional `disciplines` list; an employee only sees the types for their own discipline, and an empty list means "everyone".
- One-time data fixes go through `applied_backfills` so they run once and never stomp a later admin edit.

## Product

Live with Molly and being used for real payroll. Employees log hours (web or
mobile, signed in with a one-time email code); Molly approves, sets rates, and
produces payroll, invoices, and reconciliation reports, with QuickBooks Online
invoice sending.

## QuickBooks callback address (one-time Intuit setup)

- The server builds the QuickBooks OAuth callback from `QBO_REDIRECT_BASE_URL` first (see `callbackBaseUrl()` in `artifacts/api-server/src/routes/qbo.ts`), so once the app is published, set `QBO_REDIRECT_BASE_URL` = the permanent published URL (e.g. `https://<app>.replit.app`) in the **production** environment. Development keeps using the dev domain fallback.
- One-time Intuit registration: in the [Intuit developer portal](https://developer.intuit.com) open the app → **Keys & credentials** → **Redirect URIs**, add `<published URL>/api/qbo/callback` exactly (the Admin → QuickBooks card shows and copies this address). Intuit's save sometimes fails silently — refresh the portal page afterwards to confirm the URI is still listed.
- After that, always connect QuickBooks from the published app, not the dev preview; the published address never changes, so the link can't break again.

## User preferences

- Tone: calm, clear, professional (healthcare staffing, not flashy startup); clean typography, generous spacing, mobile-first employee views
- Simple naming: "Log Hours", "Approve Payroll", "Client Rates"
- Rate screens must look editable by Molly herself (she manages rates later)
- Onboarding is a task checklist only — never store sensitive personal documents

## Gotchas

- Run `pnpm --filter @workspace/db run push` before deploying code that adds a
  table or column. Startup seeding writes to the new shape and the server exits
  on a seeding failure, which takes the app down rather than degrading.
- Editing `openapi.yaml` means re-running codegen and then `tsc --build` at the
  repo root before typechecking any artifact — the artifacts consume the built
  lib outputs, not the sources.
- A `"200"` response in the spec needs its `content:` block. Drop it and Orval
  generates the response type as `never`, which shows up as dozens of
  "Property 'x' does not exist on type 'never'" errors far from the cause.
- `ADMIN_EMAIL` must be Molly's exact sign-in email. If it is unset or wrong,
  every admin screen fails closed and she can see nothing.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
