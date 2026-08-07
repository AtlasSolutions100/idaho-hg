// End-to-end tests for visit and mileage/per-diem invoice rate flagging,
// through the HTTP stack and database (companion to
// reports-invoice-hourly-rates.e2e.test.ts, which covers hourly entries):
// - A visit entry for a client with no billing rate for that visit type must
//   surface as a flagged $0 line (never dropped) and bump missingRateCount.
// - Mileage/per-diem pass-throughs for an employee with no reimbursement
//   rates on file must surface as flagged $0 pass-through lines.
// Positive controls assert the same paths bill correctly when rates exist.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { inArray, eq } from "drizzle-orm";
import { db, pool, timeEntriesTable, employeesTable, clientsTable } from "@workspace/db";
import app from "../app";

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
  const ratesRes = await api("/client-rates");
  expect(ratesRes.status).toBe(200);
  clientRates = ratesRes.body;

  // Seed the rate-less employee directly in the roster table.
  await db
    .insert(employeesTable)
    .values({ id: NO_RATE_EMPLOYEE, name: "ZZ NoRate TestRN", role: "RN" })
    .onConflictDoNothing();
});

afterAll(async () => {
  if (createdEntryIds.length > 0) {
    await db.delete(timeEntriesTable).where(inArray(timeEntriesTable.id, createdEntryIds));
  }
  await db.delete(employeesTable).where(eq(employeesTable.id, NO_RATE_EMPLOYEE));
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
  const res = await post("/time-entries", {
    isWeekend: false,
    isHoliday: false,
    ...entry,
  });
  expect(res.status).toBe(201);
  createdEntryIds.push(Number(res.body.id));
  expect((await post(`/time-entries/${res.body.id}/approve`)).status).toBe(200);
  return res.body;
}

async function invoiceFor(clientId: string) {
  const invoice = await api(`/reports/invoice?clientId=${clientId}&start=${START}&end=${END}`);
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
    await submitApprovedEntry({
      employeeId: NO_RATE_EMPLOYEE,
      clientId: ST_LUKES,
      date: "2026-04-11",
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
    const empRatesRes = await api("/employee-rates");
    expect(empRatesRes.status).toBe(200);
    const empRate = empRatesRes.body.find((r: any) => r.employeeId === RN_EMPLOYEE);
    expect(empRate, "expected seeded rates for Adrian Eddins").toBeTruthy();

    await submitApprovedEntry({
      employeeId: RN_EMPLOYEE,
      clientId: ST_LUKES,
      date: "2026-04-12",
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
