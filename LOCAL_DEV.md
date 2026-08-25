# Running Idaho Healthcare Staffing locally (off Replit)

This app was built on Replit. These notes get it running on a local machine
(Windows/macOS/Linux) with a self-contained Postgres — no Docker, no admin, no
Replit account needed. The Replit setup still works unchanged; nothing here
breaks it.

## Prerequisites

- Node.js 24+ (tested on 26) and `pnpm` on PATH.
- Internet access on first run (downloads dependencies + a local Postgres once).

## One-time setup

```bash
# 1. Install workspace dependencies
pnpm install

# 2. Install + initialise the local dev Postgres (in ../../.devlocal)
#    (from the repo's parent "IdahoHCS" folder)
cd ../../.devlocal && npm install && node pg.mjs up && cd -

# 3. Create the database schema
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/idahohcs" \
  node lib/db/node_modules/drizzle-kit/bin.cjs push --config ./lib/db/drizzle.config.ts
```

The server also **auto-seeds** Molly's real clients, employees, and rates on
first start, so the app has data immediately. The new per-visit-type **pay**
matrix starts empty by design — Molly fills it on the Visit Pay Rates page.

## Running it (two terminals)

```bash
# Terminal 1 — the local database (leave it running; it hosts Postgres)
node ../../.devlocal/pg.mjs up
```

```bash
# Terminal 2 — API + web dev servers together
node dev-local.mjs
```

Then open **http://localhost:5173**.

- Web app (Vite dev server): http://localhost:5173
- API (Express): http://localhost:5000/api  (health: `/api/healthz`)
- The web server proxies `/api` → the API, so the browser treats them as one
  origin (Clerk session cookies work).

### Signing in locally

Auth is Clerk (dev instance). Use a **Clerk test address** — any
`+clerk_test` email accepts the code **424242** with no real inbox:

- **Admin (Molly):** `admin+clerk_test@example.com`, code `424242`.
  Admin is whoever signs in with the `ADMIN_EMAIL` in `.env` — set to that test
  address for local dev; change it to Molly's real email for her deployment.
- **Employee:** `someone+clerk_test@example.com`, code `424242`, then claim a
  roster profile.

`node dev-local.mjs` flags: `--no-build` (skip the API rebuild and reuse the
last one), `--api-only`, `--web-only`.

## Running the tests

The API suite (Vitest, 229 tests) needs its own database. It runs sequentially
against a seeded DB (the e2e files share one database):

```bash
# one-time: create + migrate the test DB
node .devlocal/pg.mjs up   # ensures the cluster is running
# (idahohcs_test is created UTF8 automatically; push schema to it:)
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/idahohcs_test" \
  node lib/db/node_modules/drizzle-kit/bin.cjs push --config ./lib/db/drizzle.config.ts

# run the suite
cd artifacts/api-server && \
  DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/idahohcs_test" \
  node node_modules/vitest/vitest.mjs run
```

`vitest.config.ts` seeds the shared test DB once (globalSetup) and disables
file parallelism, so the suite is deterministic. Frontend/mobile use
`tsc --noEmit` (see each package).

> **Postgres encoding:** the local cluster is created as **UTF8** (`.devlocal/pg.mjs`
> passes `--encoding=UTF8`). This matters — the admin "fix an entry" audit trail
> stores `→`/`–`, which the Windows-default WIN1252 encoding can't hold. If you
> set this up before that fix, drop `idahohcs*` and recreate (or drop the leftover
> `*_win1252_bak` databases once you've confirmed the UTF8 ones work).

## What differs from Replit (all intentional, Replit-safe)

- **`pnpm-workspace.yaml`** — removed the overrides that stripped every native
  binary (a Replit/Linux optimisation) so Windows/macOS get their esbuild,
  rollup, tailwind-oxide, and lightningcss binaries. Original kept as
  `pnpm-workspace.yaml.replit-backup`.
- **`.npmrc`** — added `verify-deps-before-run=false` so pnpm's run-time
  re-install check doesn't abort on intentionally-ignored native build scripts.
- **`artifacts/staffing-app/vite.config.ts`** — added a dev-only `/api` proxy,
  active only when `VITE_DEV_API_PROXY` is set (unset on Replit → no change).
- **`lib/db/drizzle.config.ts`** — schema path is a forward-slash glob so
  drizzle-kit's file matching works on Windows (also fine on Linux).
- **`.env`** (gitignored) — local secrets + config. The API and web read it via
  `dev-local.mjs`. Not used on Replit (which injects its own Secrets).
- **`.devlocal/`** and **`dev-local.mjs`** — local-only tooling; not part of the
  deployed app.

## Handy commands

```bash
node ../../.devlocal/pg.mjs status   # is the DB up?
node ../../.devlocal/pg.mjs down     # stop the DB
node dev-local.mjs --no-build        # restart app, reuse last API build
```
