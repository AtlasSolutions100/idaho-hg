// End-to-end tests for visit and mileage/per-diem invoice rate flagging,
// through the HTTP stack and database (companion to
// reports-invoice-hourly-rates.e2e.test.ts, which covers hourly entries):
// - A visit entry for a client with no billing rate for that visit type must
//   surface as a flagged $0 line (never dropped) and bump missingRateCount.
// - Mileage/per-diem pass-throughs for an employee with no reimbursement
//   rates on file must surface as flagged $0 pass-through lines.
// Positive controls assert the same paths bill correctly when rates exist.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "node:http";
import { inArray, and, eq } from "drizzle-orm";
import { db, pool, timeEntriesTable, employeesTable, employeeRatesTable, clientsTable, clientRatesTable } from "@workspace/db";

// Client-rate / employee-rate reads, approvals, and invoice reports are
// admin-only now, so those calls run as Molly. Time-entry creation stays
// anonymous (the admin email isn't a roster employee). Clerk is mocked at the
// @clerk/express boundary.
const mockState: { email: string | null } = { email: null };
vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: () => (mockState.email ? { userId: "user_visit_mileage_e2e" } : null),
  clerkClient: {
    users: {
      getUser: async () => ({
        primaryEmailAddress: { emailAddress: mockState.email },
        emailAddresses: [{ emailAddress: mockState.email }],
      }),
      getUserList: async () => ({ data: [] }),
      createUser: async () => ({}),
    },
    sessions: { getSessionList: async () => ({ data: [] }), revokeSession: async () => ({}) },
  },
}));
const ADMIN_EMAIL = "admin-visit-mileage-e2e@example.com";
process.env.ADMIN_EMAIL = ADMIN_EMAIL;
// Fixtures are built by POSTing time entries, which now requires a session.
// Molly's is the one that may file hours for another employee, so this suite
// runs as her throughout and asAdmin restores to her rather than to nobody.
mockState.email = ADMIN_EMAIL;
const asAdmin = async <T>(fn: () => Promise<T>): Promise<T> => {
  mockState.email = ADMIN_EMAIL;
  try {
    return await fn();
  } finally {
    mockState.email = ADMIN_EMAIL;
  }
};
const { default: app } = await import("../app");

let server: Server;
let baseUrl: string;

const createdEntryIds: number[] = [];

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

// Seeded roster (stable IDs — see routes/roster.ts and routes/rates.ts seeds)
const ST_LUKES = "1";
const IDAHO_YOUTH_RANCH = "3";
const RN_EMPLOYEE = "e2ae91e4-d3d8-4447-b4ce-85de035b6700"; // Adrian Eddins, RN
const PT_EMPLOYEE = "70a76167-a476-4268-a2fc-d89c7ed15e6e"; // Dale Gibbs, PT

// Employee inserted directly (bypassing POST /employees, which always creates
// a rate row) so they have NO employee rate history at all — the only way a
// mileage/per-diem lookup can genuinely miss, since rate resolution falls back
// to the earliest known row whenever any history exists.
const NO_RATE_EMPLOYEE = "00000000-e2e0-4000-8000-a10b2c3d4e5f";

// Fixed past billing period so the run date never affects rate resolution.
const START = "2026-04-01";
const END = "2026-04-30";

let clientRates: any[] = [];

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address();
  if (address == null || typeof address === "string") throw new Error("No server port");
  baseUrl = `http://127.0.0.1:${address.port}`;

  // Trigger roster + rate seeding and capture the current billing rates so
  // assertions compare against whatever rate is actually in effect.
  expect((await api("/clients")).status).toBe(200);

  // This file posts visit entries against Idaho Youth Ranch; visit entries
  // are only accepted for visit-billing clients, so flip it on for the test.
  await db
    .update(clientsTable)
    .set({ billsByVisitType: true })
    .where(eq(clientsTable.id, IDAHO_YOUTH_RANCH));
  const ratesRes = await asAdmin(() => api("/client-rates"));
  expect(ratesRes.status).toBe(200);
  clientRates = ratesRes.body;

  // Durability guard for a fresh test DB: the app seeds employee rates only
  // when the table is empty, so a concurrent POST /employees from another test
  // file can make that seed skip, leaving the seeded RN (Adrian Eddins) with no
  // rate — which the positive control below needs. If his rate is missing, seed
  // one directly (a no-op once the roster rates are present).
  const [existingRnRate] = await db
    .select()
    .from(employeeRatesTable)
    .where(eq(employeeRatesTable.employeeId, RN_EMPLOYEE))
    .limit(1);
  if (!existingRnRate) {
    await db.insert(employeeRatesTable).values({
      employeeId: RN_EMPLOYEE,
      employeeName: "Adrian Eddins",
      employeeRole: "RN",
      hourlyRate: 50,
      visitRate: 80,
      mileageRate: 0.5,
      perDiemRate: 40,
      weekendMultiplier: 1.5,
      holidayMultiplier: 2,
      effectiveDate: "2020-01-01",
    });
  }

  // Seed the rate-less employee directly in the roster table.
  await db
    .insert(employeesTable)
    .values({ id: NO_RATE_EMPLOYEE, name: "ZZ NoRate TestRN", role: "RN" })
    .onConflictDoNothing();

  // These two cases verify the mileage/per-diem *employee-rate* resolution path:
  // a genuinely missing rate must flag a $0 pass-through line, and a present
  // employee reimbursement rate must pass through. Molly's rate sheet added a
  // St. Luke's client mileage BILLING rate ($0.725), which now takes precedence
  // over the employee lookup and would short-circuit that path. Remove it here
  // so the employee-rate fallback these cases were written to exercise is
  // genuinely hit; it is restored in afterAll. (Client mileage billing has its
  // own coverage — see invoice-report.ts — and is not the focus of these cases.)
  await db
    .delete(clientRatesTable)
    .where(and(eq(clientRatesTable.clientId, ST_LUKES), eq(clientRatesTable.visitType, "mileage")));
});

afterAll(async () => {
  if (createdEntryIds.length > 0) {
    await db.delete(timeEntriesTable).where(inArray(timeEntriesTable.id, createdEntryIds));
  }
  await db.delete(employeesTable).where(eq(employeesTable.id, NO_RATE_EMPLOYEE));
  // Restore the St. Luke's client mileage billing rate removed in beforeAll so
  // the shared test DB is left in its seeded state for later files.
  await db.insert(clientRatesTable).values({
    clientId: ST_LUKES,
    clientName: "St. Luke's Health System",
    visitType: "mileage",
    rate: 0.725,
    effectiveDate: "2024-01-01",
  });
  // Restore Idaho Youth Ranch to the simple hourly form (only St. Luke's
  // bills by visit type outside this test).
  await db
    .update(clientsTable)
    .set({ billsByVisitType: false })
    .where(eq(clientsTable.id, IDAHO_YOUTH_RANCH));
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await pool.end();
});

function currentRate(clientId: string, visitType: string): number {
  const row = clientRates.find((r) => r.clientId === clientId && r.visitType === visitType);
  expect(row, `expected a ${visitType} rate for client ${clientId}`).toBeTruthy();
  return row.rate;
}

async function submitApprovedEntry(entry: Record<string, unknown>) {
  // roster-backfill.e2e.test.ts briefly flips St. Luke's billsByVisitType off
  // while it exercises the one-time backfill; on the shared DB a visit-entry
  // POST landing in that window comes back 400 "doesn't bill by visit type".
  // Retry through the transient window.
  let res = await post("/time-entries", {
    isWeekend: false,
    isHoliday: false,
    ...entry,
  });
  for (
    let attempt = 0;
    attempt < 20 && res.status === 400 && /bill by visit type/i.test(res.body?.message ?? "");
    attempt++
  ) {
    await new Promise((r) => setTimeout(r, 50));
    res = await post("/time-entries", {
      isWeekend: false,
      isHoliday: false,
      ...entry,
    });
  }
  expect(res.status).toBe(201);
  createdEntryIds.push(Number(res.body.id));
  expect((await asAdmin(() => post(`/time-entries/${res.body.id}/approve`))).status).toBe(200);
  return res.body;
}

async function invoiceFor(clientId: string) {
  const invoice = await asAdmin(() =>
    api(`/reports/invoice?clientId=${clientId}&start=${START}&end=${END}`),
  );
  expect(invoice.status).toBe(200);
  return invoice.body;
}

describe("visit invoice missing-rate flagging (seeded clients)", () => {
  it("Idaho Youth Ranch flags a PT visit as $0: no physical-therapy rate on file", async () => {
    // IYR bills skilled-nursing visits and hourly-RN only — a physical-therapy
    // visit has no billing rate, so it must surface flagged, never dropped.
    expect(
      clientRates.find(
        (r: any) => r.clientId === IDAHO_YOUTH_RANCH && r.visitType === "physical-therapy",
      ),
    ).toBeUndefined();
    await submitApprovedEntry({
      employeeId: PT_EMPLOYEE,
      clientId: IDAHO_YOUTH_RANCH,
      date: "2026-04-09",
      visitType: "physical-therapy",
    });

    const body = await invoiceFor(IDAHO_YOUTH_RANCH);
    expect(body.missingRateCount).toBe(1);
    expect(body.unbilledCount).toBe(0);
    const line = body.lines.find((l: any) => l.kind === "visit");
    expect(line).toBeTruthy();
    expect(line.qty).toBe(1);
    expect(line.rate).toBeUndefined();
    expect(line.amount).toBe(0);
    expect(line.missingRate).toBe(true);
    expect(line.note).toBe("No billing rate on file for this visit type/date");
    // The flagged line still counts toward the invoice's entry total.
    expect(body.entryCount).toBe(1);
  });

  it("Idaho Youth Ranch bills an RN skilled-nursing visit at its seeded rate (positive control)", async () => {
    const expectedRate = currentRate(IDAHO_YOUTH_RANCH, "skilled-nursing");
    await submitApprovedEntry({
      employeeId: RN_EMPLOYEE,
      clientId: IDAHO_YOUTH_RANCH,
      date: "2026-04-10",
      visitType: "skilled-nursing",
    });

    const body = await invoiceFor(IDAHO_YOUTH_RANCH);
    const line = body.lines.find(
      (l: any) => l.kind === "visit" && l.missingRate === false,
    );
    expect(line).toBeTruthy();
    expect(line.qty).toBe(1);
    expect(line.rate).toBe(expectedRate);
    expect(line.amount).toBe(expectedRate);
    expect(line.amount).toBeGreaterThan(0);
  });
});

describe("mileage/per-diem invoice missing-rate flagging", () => {
  it("flags mileage and per diem as $0 pass-throughs when the employee has no rates on file", async () => {
    // The visit itself bills at St. Luke's skilled-nursing rate, but the
    // mileage and per-diem pass-throughs resolve from the *employee's*
    // reimbursement rates — which this employee doesn't have — so both must
    // come back as flagged $0 lines and count toward missingRateCount.
    const visitRate = currentRate(ST_LUKES, "skilled-nursing");
    // Weekday date: St. Luke's now applies a +10% weekend/holiday multiplier and
    // the server derives the day type from the date, so a weekend date would
    // scale the visit line off its base rate. This case is about the mileage/
    // per-diem pass-throughs, so keep the visit at its plain rate on a weekday.
    await submitApprovedEntry({
      employeeId: NO_RATE_EMPLOYEE,
      clientId: ST_LUKES,
      date: "2026-04-13",
      visitType: "skilled-nursing",
      mileage: 34,
      perDiem: 1,
    });

    const body = await invoiceFor(ST_LUKES);
    expect(body.missingRateCount).toBe(2);
    expect(body.unbilledCount).toBe(0);
    expect(body.entryCount).toBe(1);

    const visitLine = body.lines.find((l: any) => l.kind === "visit");
    expect(visitLine).toBeTruthy();
    expect(visitLine.missingRate).toBe(false);
    expect(visitLine.rate).toBe(visitRate);
    expect(visitLine.amount).toBe(visitRate);

    const mileageLine = body.lines.find((l: any) => l.kind === "mileage");
    expect(mileageLine).toBeTruthy();
    expect(mileageLine.qty).toBe(34);
    expect(mileageLine.rate).toBeUndefined();
    expect(mileageLine.amount).toBe(0);
    expect(mileageLine.missingRate).toBe(true);
    expect(mileageLine.note).toBe("No mileage rate on file for this employee/date");

    const perDiemLine = body.lines.find((l: any) => l.kind === "per-diem");
    expect(perDiemLine).toBeTruthy();
    expect(perDiemLine.qty).toBe(1);
    expect(perDiemLine.rate).toBeUndefined();
    expect(perDiemLine.amount).toBe(0);
    expect(perDiemLine.missingRate).toBe(true);
    expect(perDiemLine.note).toBe("No per-diem rate on file for this employee/date");

    // Only the billable visit contributes to the total.
    expect(body.total).toBe(visitRate);
  });

  it("passes mileage and per diem through at the employee's rates when on file (positive control)", async () => {
    const visitRate = currentRate(ST_LUKES, "skilled-nursing");
    const empRatesRes = await asAdmin(() => api("/employee-rates"));
    expect(empRatesRes.status).toBe(200);
    const empRate = empRatesRes.body.find((r: any) => r.employeeId === RN_EMPLOYEE);
    expect(empRate, "expected seeded rates for Adrian Eddins").toBeTruthy();

    // Weekday date (see the missing-rate case above): avoids the St. Luke's
    // weekend/holiday multiplier so mileage/per-diem pass through at the plain
    // employee reimbursement rates this positive control checks.
    await submitApprovedEntry({
      employeeId: RN_EMPLOYEE,
      clientId: ST_LUKES,
      date: "2026-04-14",
      visitType: "skilled-nursing",
      mileage: 20,
      perDiem: 1,
    });

    const body = await invoiceFor(ST_LUKES);
    const mileageLine = body.lines.find(
      (l: any) => l.kind === "mileage" && l.missingRate === false,
    );
    expect(mileageLine).toBeTruthy();
    expect(mileageLine.qty).toBe(20);
    expect(mileageLine.rate).toBe(empRate.mileageRate);
    expect(mileageLine.amount).toBeCloseTo(20 * empRate.mileageRate, 2);
    expect(mileageLine.amount).toBeGreaterThan(0);

    const perDiemLine = body.lines.find(
      (l: any) => l.kind === "per-diem" && l.missingRate === false,
    );
    expect(perDiemLine).toBeTruthy();
    expect(perDiemLine.qty).toBe(1);
    expect(perDiemLine.rate).toBe(empRate.perDiemRate);
    expect(perDiemLine.amount).toBeCloseTo(empRate.perDiemRate, 2);

    const visitLine = body.lines.find(
      (l: any) => l.kind === "visit" && l.productService?.includes("Adrian"),
    );
    expect(visitLine).toBeTruthy();
    expect(visitLine.rate).toBe(visitRate);
  });
});
