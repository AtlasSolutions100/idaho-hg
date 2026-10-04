// Per-day travel allowances at Current PT.
//
// Molly, 11 Sep 2026: "Travel for Current is per day worked... specific to
// each employee and each clinic location, in place of mileage - not in
// addition to... This is also requested by client as separate line item."
//
// The allowance is stored as billable miles and turned into money with the
// mileage rate in effect, so the amounts follow GSA instead of freezing.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "node:http";
import { inArray, eq } from "drizzle-orm";
import { db, pool, timeEntriesTable, employeeTravelAllowancesTable } from "@workspace/db";

const ADMIN_EMAIL = "admin-travel-e2e@example.com";
process.env.ADMIN_EMAIL = ADMIN_EMAIL;
const mockSession: { email: string | null } = { email: ADMIN_EMAIL };

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: () => (mockSession.email ? { userId: "user_travel_e2e" } : null),
  clerkClient: {
    users: {
      getUser: async () => ({
        primaryEmailAddress: { emailAddress: mockSession.email },
        emailAddresses: [{ emailAddress: mockSession.email }],
      }),
      getUserList: async () => ({ data: [{ id: "user_travel_e2e" }] }),
      createUser: async () => ({ id: "user_travel_e2e" }),
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

const CURRENT_PT = "6";
const PT = "d324d661-8c8c-4414-be27-855f48d4ed26"; // Paige Barbero, PT (seeded)
const FRUITLAND = "Fruitland";
const MILES = 103;
const START = "2030-07-01";
const END = "2030-07-31";
const DAY_ONE = "2030-07-02";
const DAY_TWO = "2030-07-03";

const createdIds: number[] = [];
let mileageRate = 0;

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function approved(body: Record<string, unknown>) {
  const created = await api("/time-entries", {
    method: "POST",
    body: JSON.stringify({ employeeId: PT, clientId: CURRENT_PT, ...body }),
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  createdIds.push(Number(created.body.id));
  const ok = await api(`/time-entries/${created.body.id}/approve`, { method: "POST" });
  expect(ok.status).toBe(200);
  return created.body;
}

const invoice = () =>
  api(`/reports/invoice?clientId=${CURRENT_PT}&start=${START}&end=${END}`);
const payroll = () => api(`/reports/payroll?start=${START}&end=${END}`);
const travelLine = (lines: any[]) =>
  lines.find((l: any) => l.kind === "travel");

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address();
  if (address == null || typeof address === "string") throw new Error("No server port");
  baseUrl = `http://127.0.0.1:${address.port}`;
  await db
    .delete(employeeTravelAllowancesTable)
    .where(eq(employeeTravelAllowancesTable.employeeId, PT));
  // Read the mileage rate rather than assuming it: the point of storing miles
  // is that the money follows whatever the rate currently is.
  const rates = await api("/employee-rates");
  mileageRate = rates.body.find((r: any) => r.employeeId === PT).mileageRate;
  expect(mileageRate).toBeGreaterThan(0);
});

afterAll(async () => {
  if (createdIds.length > 0) {
    await db.delete(timeEntriesTable).where(inArray(timeEntriesTable.id, createdIds));
  }
  await db
    .delete(employeeTravelAllowancesTable)
    .where(eq(employeeTravelAllowancesTable.employeeId, PT));
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await pool.end();
});

describe("travel allowances", () => {
  it("flags a day at a location with no allowance rather than billing nothing", async () => {
    await approved({ date: DAY_ONE, timeIn: "08:00", timeOut: "16:00", travelLocation: FRUITLAND });

    const res = await invoice();
    const line = travelLine(res.body.lines);
    expect(line).toBeTruthy();
    expect(line.amount).toBe(0);
    expect(line.missingRate).toBe(true);
    expect(line.note).toContain("travel allowance");
  });

  it("pays and bills one allowance per day worked, however many entries that day", async () => {
    const created = await api("/travel-allowances", {
      method: "POST",
      body: JSON.stringify({
        employeeId: PT,
        clientId: CURRENT_PT,
        location: FRUITLAND,
        miles: MILES,
        effectiveDate: "2024-01-01",
      }),
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    // A second stretch on the same day must not earn a second allowance.
    await approved({ date: DAY_ONE, timeIn: "17:00", timeOut: "19:00", travelLocation: FRUITLAND });
    await approved({ date: DAY_TWO, timeIn: "08:00", timeOut: "16:00", travelLocation: FRUITLAND });

    const perDay = Math.round(MILES * mileageRate * 100) / 100;
    const res = await invoice();
    const line = travelLine(res.body.lines);
    expect(line.qty).toBe(2); // two days, three entries
    expect(line.rate).toBeCloseTo(perDay, 2);
    expect(line.amount).toBeCloseTo(perDay * 2, 2);
    expect(line.description).toContain(FRUITLAND);

    const pay = await payroll();
    const emp = pay.body.employees.find((e: any) => e.employeeId === PT);
    const travelPay = emp.lines.filter((l: any) => l.travelLocation === FRUITLAND);
    expect(travelPay).toHaveLength(2);
    expect(travelPay[0].basePay).toBeCloseTo(perDay, 2);
  });

  it("reconciliation still ties back to the invoice with travel in it", async () => {
    const [inv, rec] = await Promise.all([
      invoice(),
      api(`/reports/reconciliation?clientId=${CURRENT_PT}&start=${START}&end=${END}`),
    ]);
    const recAmounts = rec.body.employees
      .flatMap((e: any) => e.lines ?? [])
      .reduce((sum: number, l: any) => sum + (l.amount ?? 0), 0);
    expect(Math.round(recAmounts * 100) / 100).toBeCloseTo(inv.body.total, 2);
  });

  it("refuses mileage on a travel day, because the allowance replaces it", async () => {
    const res = await api("/time-entries", {
      method: "POST",
      body: JSON.stringify({
        employeeId: PT,
        clientId: CURRENT_PT,
        date: "2030-07-09",
        timeIn: "08:00",
        timeOut: "16:00",
        travelLocation: FRUITLAND,
        mileage: 40,
      }),
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("instead of mileage");
  });

  it("keeps the old figure as history when Molly changes an allowance", async () => {
    const list = await api("/travel-allowances");
    const current = list.body.find((a: any) => a.employeeId === PT);
    const patched = await api(`/travel-allowances/${current.id}`, {
      method: "PATCH",
      body: JSON.stringify({ miles: 120, effectiveDate: "2031-01-01" }),
    });
    expect(patched.status).toBe(200);
    expect(patched.body.miles).toBe(120);

    // The 2030 days are still paid on the figure that was in force then.
    const res = await invoice();
    expect(travelLine(res.body.lines).rate).toBeCloseTo(
      Math.round(MILES * mileageRate * 100) / 100,
      2,
    );
  });
});
