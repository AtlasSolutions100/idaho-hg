// End-to-end tests for hourly invoice rate resolution against the real
// seeded clients, through the HTTP stack and database:
// - Weiser Memorial bills role-specific hourly rates (hourly-RN, hourly-PT, ...)
// - Idaho Youth Ranch bills an hourly-RN rate
// - Treasure Valley Outpatient has only a generic "hourly" rate, exercising
//   the fallback when no role-specific key exists.
// Each test creates a real time entry via the API, approves it, generates the
// invoice, and asserts the hourly line uses the client's current rate (never $0).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { inArray } from "drizzle-orm";
import { db, pool, timeEntriesTable } from "@workspace/db";
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
const WEISER = "2";
const IDAHO_YOUTH_RANCH = "3";
const TREASURE_VALLEY = "4";
const RN_EMPLOYEE = "e2ae91e4-d3d8-4447-b4ce-85de035b6700"; // Adrian Eddins, RN
const PT_EMPLOYEE = "70a76167-a476-4268-a2fc-d89c7ed15e6e"; // Dale Gibbs, PT

// Fixed past billing period so the run date never affects rate resolution.
const START = "2026-06-01";
const END = "2026-06-30";

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
  const ratesRes = await api("/client-rates");
  expect(ratesRes.status).toBe(200);
  clientRates = ratesRes.body;
});

afterAll(async () => {
  if (createdEntryIds.length > 0) {
    await db.delete(timeEntriesTable).where(inArray(timeEntriesTable.id, createdEntryIds));
  }
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

async function submitApprovedHourlyEntry(
  clientId: string,
  employeeId: string,
  date: string,
  hours: number,
) {
  const res = await post("/time-entries", {
    employeeId,
    clientId,
    date,
    hours,
    isWeekend: false,
    isHoliday: false,
  });
  expect(res.status).toBe(201);
  createdEntryIds.push(Number(res.body.id));
  expect((await post(`/time-entries/${res.body.id}/approve`)).status).toBe(200);
  return res.body;
}

async function invoiceHourlyLines(clientId: string) {
  const invoice = await api(`/reports/invoice?clientId=${clientId}&start=${START}&end=${END}`);
  expect(invoice.status).toBe(200);
  return invoice.body;
}

describe("hourly invoice rate resolution (seeded clients)", () => {
  it("Weiser Memorial bills RN hours at the hourly-RN rate", async () => {
    const expectedRate = currentRate(WEISER, "hourly-RN");
    await submitApprovedHourlyEntry(WEISER, RN_EMPLOYEE, "2026-06-10", 4);

    const body = await invoiceHourlyLines(WEISER);
    expect(body.missingRateCount).toBe(0);
    expect(body.unbilledCount).toBe(0);
    const line = body.lines.find((l: any) => l.kind === "hourly");
    expect(line).toBeTruthy();
    expect(line.qty).toBe(4);
    expect(line.rate).toBe(expectedRate);
    expect(line.amount).toBe(4 * expectedRate);
    expect(line.amount).toBeGreaterThan(0);
    // Sanity: the role-specific rate was used, not a generic hourly rate.
    expect(clientRates.find((r: any) => r.clientId === WEISER && r.visitType === "hourly")).toBeUndefined();
  });

  it("Weiser Memorial bills PT hours at the hourly-PT rate (distinct from RN)", async () => {
    const expectedRate = currentRate(WEISER, "hourly-PT");
    await submitApprovedHourlyEntry(WEISER, PT_EMPLOYEE, "2026-06-11", 3);

    const body = await invoiceHourlyLines(WEISER);
    const ptLine = body.lines.find(
      (l: any) => l.kind === "hourly" && l.productService?.includes("PT"),
    );
    expect(ptLine).toBeTruthy();
    expect(ptLine.qty).toBe(3);
    expect(ptLine.rate).toBe(expectedRate);
    expect(ptLine.amount).toBe(3 * expectedRate);
    expect(ptLine.rate).not.toBe(currentRate(WEISER, "hourly-RN"));
  });

  it("Idaho Youth Ranch bills RN hours at its hourly-RN rate", async () => {
    const expectedRate = currentRate(IDAHO_YOUTH_RANCH, "hourly-RN");
    await submitApprovedHourlyEntry(IDAHO_YOUTH_RANCH, RN_EMPLOYEE, "2026-06-12", 5);

    const body = await invoiceHourlyLines(IDAHO_YOUTH_RANCH);
    expect(body.missingRateCount).toBe(0);
    const line = body.lines.find((l: any) => l.kind === "hourly");
    expect(line).toBeTruthy();
    expect(line.qty).toBe(5);
    expect(line.rate).toBe(expectedRate);
    expect(line.amount).toBe(5 * expectedRate);
    expect(line.amount).toBeGreaterThan(0);
  });

  it("Treasure Valley Outpatient falls back to the generic hourly rate for PT hours", async () => {
    // TVO has no hourly-PT rate, so the role-specific lookup misses and the
    // route must fall back to the generic "hourly" key.
    expect(
      clientRates.find((r: any) => r.clientId === TREASURE_VALLEY && r.visitType === "hourly-PT"),
    ).toBeUndefined();
    const expectedRate = currentRate(TREASURE_VALLEY, "hourly");
    await submitApprovedHourlyEntry(TREASURE_VALLEY, PT_EMPLOYEE, "2026-06-15", 6);

    const body = await invoiceHourlyLines(TREASURE_VALLEY);
    expect(body.missingRateCount).toBe(0);
    const line = body.lines.find((l: any) => l.kind === "hourly");
    expect(line).toBeTruthy();
    expect(line.qty).toBe(6);
    expect(line.rate).toBe(expectedRate);
    expect(line.amount).toBe(6 * expectedRate);
    expect(line.amount).toBeGreaterThan(0);
  });
});
