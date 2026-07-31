// End-to-end test for GET /api/reports/invoice through the real HTTP stack
// and database: create a client + employee via the API, submit and approve
// time entries, change the client's rates mid-month, and assert the invoice
// lines split per rate with correct totals — including mileage / per-diem
// passthrough at the employee's reimbursement rates.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import {
  db,
  pool,
  clientsTable,
  clientRatesTable,
  employeesTable,
  employeeRatesTable,
  timeEntriesTable,
} from "@workspace/db";
import app from "../app";

let server: Server;
let baseUrl: string;

// Unique names so reruns never collide with the duplicate-name guards.
const runTag = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const clientName = `E2E Invoice Client ${runTag}`;
const employeeName = `E2E Invoice Nurse ${runTag}`;

let clientId = "";
let employeeId = "";

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

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address();
  if (address == null || typeof address === "string") throw new Error("No server port");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (clientId) {
    await db.delete(timeEntriesTable).where(eq(timeEntriesTable.clientId, clientId));
    await db.delete(clientRatesTable).where(eq(clientRatesTable.clientId, clientId));
    await db.delete(clientsTable).where(eq(clientsTable.id, clientId));
  }
  if (employeeId) {
    await db.delete(employeeRatesTable).where(eq(employeeRatesTable.employeeId, employeeId));
    await db.delete(employeesTable).where(eq(employeesTable.id, employeeId));
  }
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await pool.end();
});

// The billing period is a fixed past month so rate resolution is
// deterministic no matter when the test runs.
const START = "2026-03-01";
const END = "2026-03-31";

describe("GET /reports/invoice end-to-end (mid-month rate change)", () => {
  it("splits invoice lines per rate with correct totals, including mileage/per-diem passthrough", async () => {
    // --- Set up client with rate history that changes mid-month ---
    const clientRes = await post("/clients", {
      name: clientName,
      visitType: "skilled-nursing",
      rate: 999, // placeholder; effective today, never applies to March entries
    });
    expect(clientRes.status).toBe(201);
    clientId = clientRes.body.id;

    // Find the skilled-nursing rate row created with the client, then edit it
    // twice (append-only history): $80 effective Mar 1, $100 effective Mar 15.
    const ratesRes = await api("/client-rates");
    expect(ratesRes.status).toBe(200);
    const snRate = ratesRes.body.find(
      (r: any) => r.clientId === clientId && r.visitType === "skilled-nursing",
    );
    expect(snRate).toBeTruthy();
    expect((await patch(`/client-rates/${snRate.id}`, { rate: 80, effectiveDate: "2026-03-01" })).status).toBe(200);
    expect((await patch(`/client-rates/${snRate.id}`, { rate: 100, effectiveDate: "2026-03-15" })).status).toBe(200);

    // Hourly billing rate: $60 effective Mar 1, raised to $75 effective Mar 15.
    const hourlyRes = await post("/client-rates", {
      clientId,
      rateType: "hourly",
      rate: 60,
      effectiveDate: "2026-03-01",
    });
    expect(hourlyRes.status).toBe(201);
    expect((await patch(`/client-rates/${hourlyRes.body.id}`, { rate: 75, effectiveDate: "2026-03-15" })).status).toBe(200);

    // --- Employee whose mileage/per-diem rates pass through to the client ---
    const empRes = await post("/employees", {
      name: employeeName,
      role: "RN",
      hourlyRate: 48,
      visitRate: 75,
      mileageRate: 0.7,
      perDiemRate: 50,
      weekendMultiplier: 1.5,
      holidayMultiplier: 2,
    });
    expect(empRes.status).toBe(201);
    employeeId = empRes.body.id;

    // --- Submit entries across the rate change ---
    const mkEntry = (extra: Record<string, unknown>) => ({
      employeeId,
      clientId,
      isWeekend: false,
      isHoliday: false,
      ...extra,
    });
    const entries = [
      // Visits: two at the old $80 rate, two at the new $100 rate.
      mkEntry({ date: "2026-03-05", visitType: "skilled-nursing" }),
      mkEntry({ date: "2026-03-10", visitType: "skilled-nursing", mileage: 10 }),
      mkEntry({ date: "2026-03-16", visitType: "skilled-nursing" }),
      mkEntry({ date: "2026-03-20", visitType: "skilled-nursing", perDiem: 1 }),
      // Hourly: 3h at $60, then 2h at $75 after the change.
      mkEntry({ date: "2026-03-08", hours: 3 }),
      mkEntry({ date: "2026-03-18", hours: 2 }),
    ];
    const entryIds: string[] = [];
    for (const body of entries) {
      const res = await post("/time-entries", body);
      expect(res.status).toBe(201);
      entryIds.push(res.body.id);
    }
    // One extra entry that is never approved — must not be billed.
    const unapproved = await post(
      "/time-entries",
      mkEntry({ date: "2026-03-12", visitType: "skilled-nursing" }),
    );
    expect(unapproved.status).toBe(201);

    // --- Approve through the API ---
    for (const id of entryIds) {
      expect((await post(`/time-entries/${id}/approve`)).status).toBe(200);
    }

    // --- Generate the invoice ---
    const invoice = await api(`/reports/invoice?clientId=${clientId}&start=${START}&end=${END}`);
    expect(invoice.status).toBe(200);
    const { lines, total, entryCount, missingRateCount, unbilledCount } = invoice.body;

    expect(entryCount).toBe(6); // unapproved entry excluded
    expect(missingRateCount).toBe(0);
    expect(unbilledCount).toBe(0);

    // Visit lines split at the Mar 15 rate change.
    const visitLines = lines.filter((l: any) => l.kind === "visit");
    expect(visitLines).toEqual([
      expect.objectContaining({
        qty: 2, rate: 80, amount: 160,
        description: "SNV 3/5-3/10/26",
        productService: `${employeeName} RN`,
        missingRate: false,
      }),
      expect.objectContaining({
        qty: 2, rate: 100, amount: 200,
        description: "SNV 3/16-3/20/26",
        missingRate: false,
      }),
    ]);

    // Hourly lines split too.
    const hourlyLines = lines.filter((l: any) => l.kind === "hourly");
    expect(hourlyLines).toEqual([
      expect.objectContaining({ qty: 3, rate: 60, amount: 180, description: "Hourly 3/8/26" }),
      expect.objectContaining({ qty: 2, rate: 75, amount: 150, description: "Hourly 3/18/26" }),
    ]);

    // Mileage and per-diem pass through at the employee's reimbursement rates.
    const mileageLines = lines.filter((l: any) => l.kind === "mileage");
    expect(mileageLines).toEqual([
      expect.objectContaining({ qty: 10, rate: 0.7, amount: 7, description: "Mileage 3/10/26" }),
    ]);
    const perDiemLines = lines.filter((l: any) => l.kind === "per-diem");
    expect(perDiemLines).toEqual([
      expect.objectContaining({ qty: 1, rate: 50, amount: 50, description: "Per diem 3/20/26" }),
    ]);

    expect(lines).toHaveLength(6);
    // 160 + 200 + 180 + 150 + 7 + 50
    expect(total).toBe(747);
  });
});
