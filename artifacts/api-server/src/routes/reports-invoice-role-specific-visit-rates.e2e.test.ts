// End-to-end tests for discipline-specific visit rate lookup in invoice reports.
//
// The invoice route tries "{visitType}-{employeeRole}" first, then falls back
// to "{visitType}", so:
//   - An RN doing SOC should bill at the "soc-RN" rate.
//   - A PT doing SOC should bill at the "soc-PT" rate.
//   - An OT doing SOC with no "soc-OT" rate and no plain "soc" fallback should
//     surface as a $0 "missing rate" line (never dropped).
//   - A rate added via POST /client-rates with a "discipline" field should be
//     stored as "{rateType}-{discipline}" and resolved correctly.
//   - An effective-dated override to a discipline-specific rate should split
//     invoice lines at the change date.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "node:http";
import { inArray, and, eq } from "drizzle-orm";
import {
  db,
  pool,
  clientRatesTable,
  timeEntriesTable,
} from "@workspace/db";

const ADMIN_EMAIL = "admin-role-specific-visit-rates@example.com";
process.env.ADMIN_EMAIL = ADMIN_EMAIL;
const mockSession: { email: string | null } = { email: null };
vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: () => (mockSession.email ? { userId: "user_role_specific_visit" } : null),
  clerkClient: {
    users: {
      getUser: async () => ({
        primaryEmailAddress: { emailAddress: mockSession.email },
        emailAddresses: [{ emailAddress: mockSession.email }],
      }),
      getUserList: async () => ({ data: [{ id: "user_role_specific_visit" }] }),
      createUser: async () => ({ id: "user_role_specific_visit" }),
    },
    sessions: {
      getSessionList: async () => ({ data: [] }),
      revokeSession: async () => ({}),
    },
  },
}));

import app from "../app";

let server: Server;
let baseUrl: string;

// Seeded St. Luke's client and employees (stable IDs — see routes/rates.ts seeds).
const ST_LUKES = "1";
const RN_EMPLOYEE = "e2ae91e4-d3d8-4447-b4ce-85de035b6700"; // Adrian Eddins, RN
const PT_EMPLOYEE = "70a76167-a476-4268-a2fc-d89c7ed15e6e"; // Dale Gibbs, PT
// PTA discipline — the backfill seeds rates for RN/PT/OT/SLP only, so PTA
// has NO discipline-specific key for any new visit type.  This makes Lee Ormsby
// the right choice for "missing rate" and generic-fallback tests.
const PTA_EMPLOYEE = "1d2c2efe-bed4-4b2e-aba4-194130b0a0b7"; // Lee Ormsby, PTA

// Isolated billing period — not used by any other e2e test file.
const START = "2026-05-01";
const END = "2026-05-31";

const createdEntryIds: number[] = [];
// Any client rates inserted by the API test (for cleanup)
const createdRateVisitTypes: string[] = [];

async function api(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function post(path: string, body?: unknown) {
  return api(path, { method: "POST", body: body != null ? JSON.stringify(body) : undefined });
}

async function patch(path: string, body: unknown) {
  return api(path, { method: "PATCH", body: JSON.stringify(body) });
}

// Rate reads/writes and invoice reports are admin-only; time-entry creation
// stays anonymous (the admin email isn't a roster employee).
// Fixtures are built by POSTing time entries, which now requires a session.
// Molly's is the one that may file hours for another employee, so this suite
// runs as her throughout and asAdmin restores to her rather than to nobody.
mockSession.email = ADMIN_EMAIL;
const asAdmin = async <T>(fn: () => Promise<T>): Promise<T> => {
  mockSession.email = ADMIN_EMAIL;
  try {
    return await fn();
  } finally {
    mockSession.email = ADMIN_EMAIL;
  }
};

async function approveEntry(id: string) {
  const res = await asAdmin(() => post(`/time-entries/${id}/approve`));
  expect(res.status).toBe(200);
}

async function submitEntry(extra: Record<string, unknown>) {
  // roster-backfill.e2e.test.ts briefly flips St. Luke's billsByVisitType off
  // while it exercises the one-time backfill; on the shared DB a visit-entry
  // POST landing in that window comes back 400 "doesn't bill by visit type".
  // Retry through the transient window instead of forcing the flag (which would
  // race with that file's own assertion).
  let res = await post("/time-entries", {
    employeeId: extra.employeeId,
    clientId: ST_LUKES,
    isWeekend: false,
    isHoliday: false,
    ...extra,
  });
  for (
    let attempt = 0;
    attempt < 20 && res.status === 400 && /bill by visit type/i.test(res.body?.message ?? "");
    attempt++
  ) {
    await new Promise((r) => setTimeout(r, 50));
    res = await post("/time-entries", {
      employeeId: extra.employeeId,
      clientId: ST_LUKES,
      isWeekend: false,
      isHoliday: false,
      ...extra,
    });
  }
  expect(res.status).toBe(201);
  createdEntryIds.push(Number(res.body.id));
  return res.body;
}

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address();
  if (address == null || typeof address === "string") throw new Error("No server port");
  baseUrl = `http://127.0.0.1:${address.port}`;

  // Trigger seeding + backfill so discipline-specific rates are in the DB.
  expect((await asAdmin(() => api("/client-rates"))).status).toBe(200);
});

afterAll(async () => {
  if (createdEntryIds.length > 0) {
    await db
      .delete(timeEntriesTable)
      .where(inArray(timeEntriesTable.id, createdEntryIds));
  }
  // Remove any rates this test inserted via the API (cleanup by visitType key).
  for (const vt of createdRateVisitTypes) {
    await db
      .delete(clientRatesTable)
      .where(
        and(
          eq(clientRatesTable.clientId, ST_LUKES),
          eq(clientRatesTable.visitType, vt),
        ),
      );
  }
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await pool.end();
});

describe("Role-specific visit rate lookup on invoice report", () => {
  it("bills RN at soc-RN rate and PT at soc-PT rate; PTA missing rate surfaces as $0", async () => {
    // The backfill seeds: soc-RN=$336, soc-PT=$376 for St. Luke's.
    // PTA has no "soc-PTA" and there is no plain "soc" fallback → missing rate.
    const rnEntry  = await submitEntry({ employeeId: RN_EMPLOYEE,  date: "2026-05-05", visitType: "soc" });
    const ptEntry  = await submitEntry({ employeeId: PT_EMPLOYEE,  date: "2026-05-06", visitType: "soc" });
    const ptaEntry = await submitEntry({ employeeId: PTA_EMPLOYEE, date: "2026-05-07", visitType: "soc" });

    await approveEntry(rnEntry.id);
    await approveEntry(ptEntry.id);
    await approveEntry(ptaEntry.id);

    const invoice = await asAdmin(() =>
      api(`/reports/invoice?clientId=${ST_LUKES}&start=${START}&end=${END}`),
    );
    expect(invoice.status).toBe(200);
    const { lines, missingRateCount } = invoice.body;

    // RN — should resolve "soc-RN" = $336
    const rnLine = lines.find((l: any) => l.kind === "visit" && l.productService.includes("Eddins"));
    expect(rnLine).toBeTruthy();
    expect(rnLine.missingRate).toBe(false);
    expect(rnLine.rate).toBe(336);
    expect(rnLine.amount).toBe(336);

    // PT — should resolve "soc-PT" = $376
    const ptLine = lines.find((l: any) => l.kind === "visit" && l.productService.includes("Gibbs"));
    expect(ptLine).toBeTruthy();
    expect(ptLine.missingRate).toBe(false);
    expect(ptLine.rate).toBe(376);
    expect(ptLine.amount).toBe(376);

    // PTA — no "soc-PTA" or plain "soc" rate → missing rate, bills $0
    const ptaLine = lines.find((l: any) => l.kind === "visit" && l.productService.includes("Ormsby"));
    expect(ptaLine).toBeTruthy();
    expect(ptaLine.missingRate).toBe(true);
    expect(ptaLine.amount).toBe(0);

    expect(missingRateCount).toBeGreaterThanOrEqual(1);
  });

  it("POST /client-rates with discipline stores key correctly and resolves on invoice", async () => {
    // Add "non-visit-PTA" rate via the API using the new discipline field.
    // PTA has no backfilled rates for any new visit type, so this is guaranteed to be new.
    const addRes = await asAdmin(() =>
      api("/client-rates", {
        method: "POST",
        body: JSON.stringify({
          clientId: ST_LUKES,
          rateType: "non-visit",
          discipline: "PTA",
          rate: 75,
          effectiveDate: "2026-05-01",
        }),
      }),
    );
    expect(addRes.status).toBe(201);
    // The stored visitType should be the combined key.
    expect(addRes.body.visitType).toBe("non-visit-PTA");
    createdRateVisitTypes.push("non-visit-PTA");

    // Submit and approve a Non-visit entry for Lee Ormsby (PTA).
    // Use a weekday: St. Luke's now carries a +10% weekend/holiday multiplier
    // (weekendMultiplier = holidayMultiplier = 1.1), and the server derives the
    // weekend flag from the date. 2026-05-10 was a Sunday, which would scale the
    // billed rate to 82.5; this case is about the discipline-key *base* rate
    // resolving correctly, so bill it on a weekday (Mon 2026-05-11) at 75.
    const nvEntry = await submitEntry({ employeeId: PTA_EMPLOYEE, date: "2026-05-11", visitType: "non-visit" });
    await approveEntry(nvEntry.id);

    const invoice = await asAdmin(() =>
      api(`/reports/invoice?clientId=${ST_LUKES}&start=${START}&end=${END}`),
    );
    expect(invoice.status).toBe(200);
    const { lines } = invoice.body;

    // Non-visit line for Lee Ormsby (PTA) — should bill at the $75 discipline rate.
    const nvLine = lines.find(
      (l: any) => l.kind === "visit" && l.description.includes("Non-visit") && l.productService.includes("Ormsby"),
    );
    expect(nvLine).toBeTruthy();
    expect(nvLine.missingRate).toBe(false);
    expect(nvLine.rate).toBe(75);
  });

  it("future effective-dated update to a discipline-specific rate splits invoice lines", async () => {
    // The backfill seeds "recert-PT" = $235 for St. Luke's.
    // Raise it mid-month to $250 so entries split across the rate change.
    const ratesRes = await asAdmin(() => api("/client-rates"));
    const recertPtRate = ratesRes.body.find(
      (r: any) => r.clientId === ST_LUKES && r.visitType === "recert-PT",
    );
    expect(recertPtRate).toBeTruthy();

    // $250 effective May 15: entries before → $235, entries after → $250.
    await asAdmin(() => patch(`/client-rates/${recertPtRate.id}`, { rate: 250, effectiveDate: "2026-05-15" }));

    // Two Recert entries for Dale Gibbs (PT): one before and one after the change.
    const earlyEntry = await submitEntry({ employeeId: PT_EMPLOYEE, date: "2026-05-08", visitType: "recert" });
    const lateEntry  = await submitEntry({ employeeId: PT_EMPLOYEE, date: "2026-05-20", visitType: "recert" });
    await approveEntry(earlyEntry.id);
    await approveEntry(lateEntry.id);

    const invoice = await asAdmin(() =>
      api(`/reports/invoice?clientId=${ST_LUKES}&start=${START}&end=${END}`),
    );
    expect(invoice.status).toBe(200);
    const { lines } = invoice.body;

    // Invoice lines should split at the rate change for Gibbs's Recert entries.
    const recertLines = lines.filter(
      (l: any) => l.kind === "visit" && l.description.includes("Recert") && l.productService.includes("Gibbs"),
    );
    expect(recertLines.length).toBe(2);

    const oldRateLine = recertLines.find((l: any) => l.rate === 235);
    const newRateLine = recertLines.find((l: any) => l.rate === 250);
    expect(oldRateLine).toBeTruthy();
    expect(newRateLine).toBeTruthy();
    expect(oldRateLine.missingRate).toBe(false);
    expect(newRateLine.missingRate).toBe(false);
  });

  it("generic fallback: plain visit-type rate is used when no discipline-specific key exists", async () => {
    // Add a plain "training" rate (no discipline) for St. Luke's.
    // PTA has no "training-PTA" key → should fall back to plain "training".
    const addRes = await asAdmin(() =>
      api("/client-rates", {
        method: "POST",
        body: JSON.stringify({
          clientId: ST_LUKES,
          rateType: "training",
          rate: 50,
          effectiveDate: "2026-05-01",
        }),
      }),
    );
    // If "training" already exists (e.g. from a prior test run), accept 409.
    expect([201, 409]).toContain(addRes.status);
    if (addRes.status === 201) {
      createdRateVisitTypes.push("training");
    }

    // PTA employee does a Training visit — "training-PTA" is not seeded,
    // so the lookup must fall back to the plain "training" rate.
    const trainEntry = await submitEntry({ employeeId: PTA_EMPLOYEE, date: "2026-05-14", visitType: "training" });
    await approveEntry(trainEntry.id);

    const invoice = await asAdmin(() =>
      api(`/reports/invoice?clientId=${ST_LUKES}&start=${START}&end=${END}`),
    );
    expect(invoice.status).toBe(200);
    const { lines } = invoice.body;

    const trainLine = lines.find(
      (l: any) => l.kind === "visit" && l.description.includes("Training") && l.productService.includes("Ormsby"),
    );
    expect(trainLine).toBeTruthy();
    expect(trainLine.missingRate).toBe(false);
    expect(trainLine.rate).toBe(50);
  });
});
