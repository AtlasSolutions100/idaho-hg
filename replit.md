# Idaho Healthcare Staffing (Hodge Staffing Time App)

Time-entry and payroll-approval app for Molly Hodge's healthcare staffing company, Idaho Healthcare Staffing: employees log hours on mobile, Molly approves payroll and manages rates from an admin dashboard.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/staffing-app/` — the web app (served at `/`); pages in `src/pages/`, mock data + types in `src/lib/data.ts`, theme in `src/index.css`
- `lib/api-spec/openapi.yaml` — API contract (health + time-entry endpoints: list, create, approve, reject, approve-all)
- `lib/db/src/schema/` — DB schema (`time_entries` table)
- `artifacts/api-server/src/routes/time-entries.ts` — time-entry route handlers (Zod-validated)

## Architecture decisions

- No real auth yet: employee/client rosters are hardcoded in `time-entries.ts` routes; the app acts as employee "1" (Sarah Martinez). Phase 3+ replaces with real accounts.
- Time-entry names (employee/client) are denormalized onto rows at submit time so the approval table needs no joins.
- Clients/employees/rates in the UI still come from `src/lib/data.ts` mock data; only time entries are database-backed.

## Product

Phase 2 (done): working time entry → approval loop. Employees submit real entries (persisted in Postgres), admins approve/reject individually or Approve All; both sides read the same data via the generated API client.

Phase 1 (done): clickable visual shell, no backend. Role switcher at `/`; employee side (`/employee`, mobile-first Log Hours flow + entries list); admin side (`/admin` dashboard, Approve Payroll, Client Rates, Employee Rates, Reports placeholders — Pezwise payroll / invoices / reconciliation — and Onboarding checklist). All data is hardcoded placeholder content.

## QuickBooks callback address (one-time Intuit setup)

- The server builds the QuickBooks OAuth callback from `QBO_REDIRECT_BASE_URL` first (see `callbackBaseUrl()` in `artifacts/api-server/src/routes/qbo.ts`), so once the app is published, set `QBO_REDIRECT_BASE_URL` = the permanent published URL (e.g. `https://<app>.replit.app`) in the **production** environment. Development keeps using the dev domain fallback.
- One-time Intuit registration: in the [Intuit developer portal](https://developer.intuit.com) open the app → **Keys & credentials** → **Redirect URIs**, add `<published URL>/api/qbo/callback` exactly (the Admin → QuickBooks card shows and copies this address). Intuit's save sometimes fails silently — refresh the portal page afterwards to confirm the URI is still listed.
- After that, always connect QuickBooks from the published app, not the dev preview; the published address never changes, so the link can't break again.

## User preferences

- Tone: calm, clear, professional (healthcare staffing, not flashy startup); clean typography, generous spacing, mobile-first employee views
- Simple naming: "Log Hours", "Approve Payroll", "Client Rates"
- Rate screens must look editable by Molly herself (she manages rates later)
- Onboarding is a task checklist only — never store sensitive personal documents

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
