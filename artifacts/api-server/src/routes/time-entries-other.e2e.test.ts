// End-to-end tests for "Other" one-off entries (training, meetings,
// professional development): creation rules, the admin pricing endpoint,
// kind immutability on edit, employee-edit price invalidation, and how
// Other entries flow through the payroll, invoice, and reconciliation
// reports — flagged when unpriced, never silently $0, and billed to the
// client only when Molly sets a billing amount.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import {
  db,
  pool,
  clientsTable,
  employeesTable,
  employeeRatesTable,
  timeEntriesTable,
} from "@workspace/db";

// Clerk mock: mockSession.email = ADMIN_EMAIL makes requests count as Molly;
// an employee email resolves to that roster profile; null = anonymous.
const ADMIN_EMAIL = "admin-other-e2e@example.com";
process.env.ADMIN_EMAIL = ADMIN_EMAIL;
const mockSession: { email: string | null } = { email: null };
vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: () => (mockSession.email ? { userId: "user_other_e2e" } : null),
  clerkClient: {
    users: {
      getUser: async () => ({
        primaryEmailAddress: { emailAddress: mockSession.email },
        emailAddresses: [{ emailAddress: mockSession.email }],
      }),
      getUserList: async () => ({ data: [{ id: "user_other_e2e" }] }),
      createUser: async () => ({ id: "user_other_e2e" }),
    },
    sessions: {
      getSessionList: async () => ({ data: [] }),
      revokeSession: async () => ({}),
    },
  },
}));

const { default: app } = await import("../app");

let server: Server;
let baseUrl: string;

const EMP_ID = "e2e-other-employee";
const EMP_EMAIL = "other-e2e-nurse@example.com";
const CLIENT_ID = "e2e-other-client";

// Fixed, otherwise-unused billing month so shared-DB parallel runs and
// leftover data can never bleed into report totals (see memory notes).
const MONTH_START = "2027-09-01";
const MONTH_END = "2027-09-30";
const D = (day: number) => `2027-09-${String(day).padStart(2, "0")}`;

async function cleanup() {
  await db.delete(timeEntriesTable).where(eq(timeEntriesTable.employeeId, EMP_ID));
  await db.delete(employeeRatesTable).where(eq(employeeRatesTable.employeeId, EMP_ID));
  await db.delete(clientsTable).where(eq(clientsTable.id, CLIENT_ID));
  await db.delete(employeesTable).where(eq(employeesTable.id, EMP_ID));
}

beforeAll(async () => {
  await cleanup();
  await db.insert(employeesTable).values({
    id: EMP_ID,
    name: "Other E2E Nurse",
    role: "RN",
    email: EMP_EMAIL,
  });
  await db.insert(clientsTable).values({ id: CLIENT_ID, name: "Other E2E Clinic" });
  await db.insert(employeeRatesTable).values({
    employeeId: EMP_ID,
    employeeName: "Other E2E Nurse",
    employeeRole: "RN",
    hourlyRate: 50,
    visitRate: 80,
    mileageRate: 0.5,
    perDiemRate: 40,
    weekendMultiplier: 1.5,
    holidayMultiplier: 2,
    effectiveDate: "2020-01-01",
  });
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address();
  if (address == null || typeof address === "string") throw new Error("No server port");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await cleanup();
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await pool.end();
});

async function api(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const post = (path: string, body?: unknown) =>
  api(path, { method: "POST", body: body != null ? JSON.stringify(body) : undefined });
const patch = (path: string, body: unknown) =>
  api(path, { method: "PATCH", body: JSON.stringify(body) });

const asAdmin = async <T>(fn: () => Promise<T>): Promise<T> => {
  mockSession.email = ADMIN_EMAIL;
  try {
    return await fn();
  } finally {
    mockSession.email = null;
  }
};

function otherEntryBody(day: number, extra: Record<string, unknown> = {}) {
  return {
    employeeId: EMP_ID,
    clientId: CLIENT_ID,
    date: D(day),
    isOther: true,
    timeIn: "09:00",
    timeOut: "12:00",
    note: "3 hours professional development at Weiser School District",
    ...extra,
  };
}

describe("Other one-off entries end-to-end", () => {
  it("rejects an Other entry without a description", async () => {
    const res = await post("/time-entries", otherEntryBody(1, { note: "  " }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/describe/i);
  });

  it("rejects an Other entry without any time worked", async () => {
    const res = await post("/time-entries", {
      ...otherEntryBody(1),
      timeIn: undefined,
      timeOut: undefined,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/time in and out/i);
  });

  it("rejects visit type and per diem on Other entries", async () => {
    const withVisit = await post("/time-entries", otherEntryBody(1, { visitType: "skilled-nursing" }));
    expect(withVisit.status).toBe(400);
    expect(withVisit.body.message).toMatch(/visit type/i);
    const withPerDiem = await post("/time-entries", otherEntryBody(1, { perDiemType: "full" }));
    expect(withPerDiem.status).toBe(400);
    expect(withPerDiem.body.message).toMatch(/per diem/i);
  });

  it("creates an Other entry with hours from clock times and no pricing yet", async () => {
    const res = await post("/time-entries", otherEntryBody(2));
    expect(res.status).toBe(201);
    expect(res.body.isOther).toBe(true);
    expect(res.body.hours).toBe(3);
    expect(res.body.customPayAmount).toBeUndefined();
    expect(res.body.visitType).toBeUndefined();
  });

  it("pricing endpoint is admin-only, Other-only, and locked after approval", async () => {
    const created = await post("/time-entries", otherEntryBody(3));
    expect(created.status).toBe(201);
    const id = created.body.id;

    // Anonymous: refused.
    const anon = await post(`/time-entries/${id}/price`, { customPayAmount: 100 });
    expect(anon.status).toBe(401);

    // Admin prices it (pay only — no client billing).
    const priced = await asAdmin(() =>
      post(`/time-entries/${id}/price`, { customPayAmount: 120 }),
    );
    expect(priced.status).toBe(200);
    expect(priced.body.customPayAmount).toBe(120);
    expect(priced.body.customBillAmount).toBeUndefined();

    // Non-Other entries can't be priced.
    const hourly = await post("/time-entries", {
      employeeId: EMP_ID,
      clientId: CLIENT_ID,
      date: D(4),
      timeIn: "08:00",
      timeOut: "10:00",
    });
    expect(hourly.status).toBe(201);
    const notOther = await asAdmin(() =>
      post(`/time-entries/${hourly.body.id}/price`, { customPayAmount: 10 }),
    );
    expect(notOther.status).toBe(400);
    // Reject the helper hourly entry so another file's global approve-all
    // (shared DB, concurrent test files) can't approve it into this month's
    // invoice as a missing-rate line.
    await post(`/time-entries/${hourly.body.id}/reject`);

    // Approved = locked.
    const approved = await post(`/time-entries/${id}/approve`);
    expect(approved.status).toBe(200);
    const afterApproval = await asAdmin(() =>
      post(`/time-entries/${id}/price`, { customPayAmount: 999 }),
    );
    expect(afterApproval.status).toBe(400);
  });

  it("keeps the entry Other on edit, clears pricing on employee edits but not admin edits", async () => {
    const created = await post("/time-entries", otherEntryBody(5));
    const id = created.body.id;
    await asAdmin(() => post(`/time-entries/${id}/price`, { customPayAmount: 75 }));

    // Editing can't turn it into a visit entry — even for its owner.
    mockSession.email = EMP_EMAIL;
    let toVisit;
    try {
      toVisit = await patch(`/time-entries/${id}`, {
        clientId: CLIENT_ID,
        date: D(5),
        visitType: "skilled-nursing",
        note: "still a one-off",
      });
    } finally {
      mockSession.email = null;
    }
    expect(toVisit.status).toBe(400);
    expect(toVisit.body.message).toMatch(/visit type/i);

    // Admin fix preserves Molly's pricing.
    const adminEdit = await asAdmin(() =>
      patch(`/time-entries/${id}`, {
        clientId: CLIENT_ID,
        date: D(5),
        timeIn: "09:00",
        timeOut: "13:00",
        note: "4 hours professional development (corrected)",
      }),
    );
    expect(adminEdit.status).toBe(200);
    expect(adminEdit.body.isOther).toBe(true);
    expect(adminEdit.body.customPayAmount).toBe(75);

    // Employee edit invalidates the price — the work may have changed.
    mockSession.email = EMP_EMAIL;
    try {
      const empEdit = await patch(`/time-entries/${id}`, {
        clientId: CLIENT_ID,
        date: D(5),
        timeIn: "09:00",
        timeOut: "14:00",
        note: "5 hours professional development actually",
      });
      expect(empEdit.status).toBe(200);
      expect(empEdit.body.isOther).toBe(true);
      expect(empEdit.body.customPayAmount).toBeUndefined();
      expect(empEdit.body.customBillAmount).toBeUndefined();
    } finally {
      mockSession.email = null;
    }
  });

  it("pays the custom amount on payroll (no multipliers), flags unpriced entries, and reimburses mileage", async () => {
    // Priced one-off with mileage on a Saturday — multiplier must stay 1.
    const priced = await post("/time-entries", otherEntryBody(4, { mileage: 10, date: D(4) }));
    // D(4) = Sept 4, 2027 (Saturday).
    expect(priced.body.isWeekend).toBe(true);
    await asAdmin(() => post(`/time-entries/${priced.body.id}/price`, { customPayAmount: 200 }));
    // Unpriced one-off — must be flagged, not silently $0-and-fine.
    const unpriced = await post("/time-entries", otherEntryBody(6));
    await post(`/time-entries/${priced.body.id}/approve`);
    await post(`/time-entries/${unpriced.body.id}/approve`);

    const report = await api(`/reports/payroll?start=${MONTH_START}&end=${MONTH_END}`);
    expect(report.status).toBe(200);
    const emp = report.body.employees.find((e: any) => e.employeeId === EMP_ID);
    expect(emp).toBeTruthy();

    const pricedLine = emp.lines.find((l: any) => l.entryId === priced.body.id);
    expect(pricedLine.isOther).toBe(true);
    expect(pricedLine.description).toMatch(/professional development/);
    expect(pricedLine.multiplier).toBe(1);
    expect(pricedLine.basePay).toBe(200);
    expect(pricedLine.mileagePay).toBe(5); // 10 mi × $0.50
    expect(pricedLine.total).toBe(205);
    expect(pricedLine.missingRate).toBe(false);

    const unpricedLine = emp.lines.find((l: any) => l.entryId === unpriced.body.id);
    expect(unpricedLine.missingRate).toBe(true);
    expect(unpricedLine.basePay).toBe(0);
    expect(report.body.missingRateCount).toBeGreaterThanOrEqual(1);
  });

  it("bills the client only when Molly set a billing amount, as one labeled flat line", async () => {
    const billed = await post("/time-entries", otherEntryBody(10, { mileage: 8 }));
    await asAdmin(() =>
      post(`/time-entries/${billed.body.id}/price`, { customPayAmount: 90, customBillAmount: 130 }),
    );
    const notBilled = await post("/time-entries", otherEntryBody(11, { note: "staff meeting" }));
    await asAdmin(() => post(`/time-entries/${notBilled.body.id}/price`, { customPayAmount: 60 }));
    await post(`/time-entries/${billed.body.id}/approve`);
    await post(`/time-entries/${notBilled.body.id}/approve`);

    const invoice = await api(
      `/reports/invoice?clientId=${CLIENT_ID}&start=${MONTH_START}&end=${MONTH_END}`,
    );
    expect(invoice.status).toBe(200);
    const otherLines = invoice.body.lines.filter((l: any) => l.kind === "other");
    expect(otherLines).toHaveLength(1);
    expect(otherLines[0].amount).toBe(130);
    expect(otherLines[0].qty).toBe(1);
    expect(otherLines[0].missingRate).toBe(false);
    expect(otherLines[0].description).toMatch(/professional development/);
    // No mileage passthrough for Other entries — the flat amount is everything.
    const mileageLines = invoice.body.lines.filter((l: any) => l.kind === "mileage");
    expect(mileageLines).toHaveLength(0);
    // Unbilled one-offs are intentional, not "unbilled work" warnings.
    expect(invoice.body.unbilledCount).toBe(0);
    expect(invoice.body.missingRateCount).toBe(0);
  });

  it("approve-all skips unpriced Other entries so they never lock without a pay amount", async () => {
    const unpriced = await post("/time-entries", otherEntryBody(15, { note: "team meeting" }));
    const priced = await post("/time-entries", otherEntryBody(16, { note: "training day" }));
    await asAdmin(() => post(`/time-entries/${priced.body.id}/price`, { customPayAmount: 45 }));

    const result = await post("/time-entries/approve-all");
    expect(result.status).toBe(200);
    expect(result.body.skippedUnpricedOtherCount).toBeGreaterThanOrEqual(1);

    const list = await api(`/time-entries?employeeId=${EMP_ID}`);
    const unpricedAfter = list.body.find((e: any) => e.id === unpriced.body.id);
    const pricedAfter = list.body.find((e: any) => e.id === priced.body.id);
    expect(unpricedAfter.status).toBe("submitted"); // still open for pricing
    expect(pricedAfter.status).toBe("approved");

    // Once priced, it can be approved normally.
    await asAdmin(() => post(`/time-entries/${unpriced.body.id}/price`, { customPayAmount: 30 }));
    const approve = await post(`/time-entries/${unpriced.body.id}/approve`);
    expect(approve.status).toBe(200);
  });

  it("labels Other lines on the reconciliation report with hours in the totals", async () => {
    const recon = await api(
      `/reports/reconciliation?clientId=${CLIENT_ID}&start=${MONTH_START}&end=${MONTH_END}`,
    );
    expect(recon.status).toBe(200);
    const group = recon.body.employees.find((e: any) => e.employeeId === EMP_ID);
    expect(group).toBeTruthy();
    const otherLines = group.lines.filter((l: any) => l.isOther);
    expect(otherLines.length).toBeGreaterThanOrEqual(1);
    expect(otherLines[0].note).toBeTruthy();
    expect(group.totalHours).toBeGreaterThan(0);
  });
});
