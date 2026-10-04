// End-to-end tests for the four things Molly asked for after seeing the demo:
//
//  1. The same visit more than once in a day ("2 evals and a discharge") —
//     one entry per visit type carrying how many, priced and billed per unit.
//  2. Visit types billed in 15-minute blocks (Hospital at Home, drive time)
//     rather than as one flat visit.
//  3. Mileage entered once for a date range instead of day by day.
//  4. Visit types narrowed to the disciplines that can perform them.
//
// These run against the real seeded St. Luke's client and roster employees so
// the amounts asserted here are Molly's own rates from the master sheet:
//   RN eval      bill 210    pay 168
//   RN discharge bill 168    pay 134.40
//   mileage      bill 0.725  (the employee's own reimbursement rate is read
//                             from the API rather than assumed — see below)
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "node:http";
import { inArray, eq } from "drizzle-orm";
import { db, pool, timeEntriesTable, employeesTable } from "@workspace/db";

const ADMIN_EMAIL = "admin-quantity-e2e@example.com";
process.env.ADMIN_EMAIL = ADMIN_EMAIL;
const mockSession: { email: string | null } = { email: null };
vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: () => (mockSession.email ? { userId: "user_quantity_e2e" } : null),
  clerkClient: {
    users: {
      getUser: async () => ({
        primaryEmailAddress: { emailAddress: mockSession.email },
        emailAddresses: [{ emailAddress: mockSession.email }],
      }),
      getUserList: async () => ({ data: [{ id: "user_quantity_e2e" }] }),
      createUser: async () => ({ id: "user_quantity_e2e" }),
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

// Seeded St. Luke's and roster employees (stable IDs — see routes/rates.ts).
const ST_LUKES = "1";
const RN_EMPLOYEE = "e2ae91e4-d3d8-4447-b4ce-85de035b6700"; // Adrian Eddins, RN
const PT_EMPLOYEE = "c173f799-2391-4acb-b7d8-bd6c1f7811ca"; // Quinton Erhard, PT

// Isolated billing period — April 2029 is used by no other e2e file, and every
// date below is a weekday and not a holiday, so no multiplier applies.
const START = "2029-04-01";
const END = "2029-04-30";

const createdEntryIds: number[] = [];

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

// These fixtures run against the seeded roster (Adrian Eddins RN), whose row
// has no sign-in email and must not be rewritten by a test. Logging hours now
// needs a session, so Molly files them — the one caller who may name another
// employee. asAdmin is kept for readability at the admin-only call sites.
mockSession.email = ADMIN_EMAIL;

const asAdmin = async <T>(fn: () => Promise<T>): Promise<T> => {
  mockSession.email = ADMIN_EMAIL;
  return fn();
};

/** Create an entry and approve it so it reaches the reports. */
async function createApproved(body: Record<string, unknown>): Promise<any> {
  const created = await post("/time-entries", {
    employeeId: RN_EMPLOYEE,
    clientId: ST_LUKES,
    ...body,
  });
  expect(created.status).toBe(201);
  createdEntryIds.push(Number(created.body.id));
  const approved = await asAdmin(() =>
    post(`/time-entries/${created.body.id}/approve`),
  );
  expect(approved.status).toBe(200);
  return created.body;
}

async function cleanup() {
  if (createdEntryIds.length > 0) {
    await db.delete(timeEntriesTable).where(inArray(timeEntriesTable.id, createdEntryIds));
    createdEntryIds.length = 0;
  }
}

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address();
  if (address == null || typeof address === "string") throw new Error("No server port");
  baseUrl = `http://127.0.0.1:${address.port}`;
  // Touch the catalog so seeding (and the discipline/unit backfill) has run
  // before any assertion depends on it.
  await api("/visit-types");
});

afterAll(async () => {
  await cleanup();
  // Leave the RN's discipline as the roster seeds it, whatever the
  // discipline-change test did.
  await db
    .update(employeesTable)
    .set({ role: "RN" })
    .where(eq(employeesTable.id, RN_EMPLOYEE));
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await pool.end();
});

describe("visit quantity — the same visit more than once in a day", () => {
  it("defaults to 1 so entries that don't mention it are unchanged", async () => {
    const entry = await createApproved({ date: "2029-04-02", visitType: "eval" });
    expect(entry.quantity).toBe(1);
    await cleanup();
  });

  it("pays and bills two evals and a discharge at Molly's real rates", async () => {
    await createApproved({ date: "2029-04-03", visitType: "eval", quantity: 2 });
    await createApproved({ date: "2029-04-03", visitType: "discharge" });

    const payroll = await asAdmin(() => api(`/reports/payroll?start=${START}&end=${END}`));
    expect(payroll.status).toBe(200);
    const employee = payroll.body.employees.find(
      (e: { employeeId: string }) => e.employeeId === RN_EMPLOYEE,
    );
    // 2 x 168.00 (eval) + 134.40 (discharge)
    expect(employee.total).toBeCloseTo(470.4, 2);
    // Three visits were performed, even though they are two rows.
    expect(employee.visitCount).toBe(3);

    const invoice = await asAdmin(() =>
      api(`/reports/invoice?clientId=${ST_LUKES}&start=${START}&end=${END}`),
    );
    expect(invoice.status).toBe(200);
    const evalLine = invoice.body.lines.find((l: any) => l.description.includes("Eval"));
    expect(evalLine.qty).toBe(2);
    expect(evalLine.rate).toBeCloseTo(210, 2);
    expect(evalLine.amount).toBeCloseTo(420, 2);
    // 2 x 210 (eval) + 168 (discharge)
    expect(invoice.body.total).toBeCloseTo(588, 2);
    await cleanup();
  });

  it("reconciliation counts visits performed, and still ties to the invoice", async () => {
    await createApproved({ date: "2029-04-04", visitType: "eval", quantity: 3 });

    const recon = await asAdmin(() =>
      api(`/reports/reconciliation?clientId=${ST_LUKES}&start=${START}&end=${END}`),
    );
    expect(recon.status).toBe(200);
    expect(recon.body.totals.totalVisits).toBe(3);

    const invoice = await asAdmin(() =>
      api(`/reports/invoice?clientId=${ST_LUKES}&start=${START}&end=${END}`),
    );
    // The reconciliation exists to prove the invoice — the two must agree.
    expect(recon.body.totals.totalAmount).toBeCloseTo(invoice.body.total, 2);
    expect(invoice.body.total).toBeCloseTo(630, 2); // 3 x 210
    await cleanup();
  });

  it("rejects a fractional or zero count, and a count on a non-visit entry", async () => {
    const half = await post("/time-entries", {
      employeeId: RN_EMPLOYEE,
      clientId: ST_LUKES,
      date: "2029-04-05",
      visitType: "eval",
      quantity: 1.5,
    });
    expect(half.status).toBe(400);
    expect(half.body.message).toMatch(/whole number/i);

    const zero = await post("/time-entries", {
      employeeId: RN_EMPLOYEE,
      clientId: ST_LUKES,
      date: "2029-04-05",
      visitType: "eval",
      quantity: 0,
    });
    expect(zero.status).toBe(400);

    // Weiser (id "2") bills hourly — a count there would apply to nothing.
    const hourly = await post("/time-entries", {
      employeeId: RN_EMPLOYEE,
      clientId: "2",
      date: "2029-04-05",
      timeIn: "08:00",
      timeOut: "16:00",
      quantity: 3,
    });
    expect(hourly.status).toBe(400);
    expect(hourly.body.message).toMatch(/only applies to visit entries/i);
  });
});

describe("batch submit with per-line counts", () => {
  it("accepts the same visit type twice as one line with a count", async () => {
    const res = await post("/time-entries/batch", {
      employeeId: RN_EMPLOYEE,
      clientId: ST_LUKES,
      date: "2029-04-09",
      visits: [
        { visitType: "eval", quantity: 2 },
        { visitType: "discharge" },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(2);
    for (const row of res.body) createdEntryIds.push(Number(row.id));
    const evalRow = res.body.find((r: any) => r.visitType === "eval");
    const dcRow = res.body.find((r: any) => r.visitType === "discharge");
    expect(evalRow.quantity).toBe(2);
    expect(dcRow.quantity).toBe(1);
    await cleanup();
  });

  it("still accepts the older visitTypes list, counting each once", async () => {
    const res = await post("/time-entries/batch", {
      employeeId: RN_EMPLOYEE,
      clientId: ST_LUKES,
      date: "2029-04-10",
      visitTypes: ["eval", "discharge"],
    });
    expect(res.status).toBe(201);
    for (const row of res.body) createdEntryIds.push(Number(row.id));
    expect(res.body.every((r: any) => r.quantity === 1)).toBe(true);
    await cleanup();
  });

  it("refuses both shapes at once rather than guessing", async () => {
    const res = await post("/time-entries/batch", {
      employeeId: RN_EMPLOYEE,
      clientId: ST_LUKES,
      date: "2029-04-11",
      visits: [{ visitType: "eval" }],
      visitTypes: ["discharge"],
    });
    expect(res.status).toBe(400);
  });
});

describe("visit types paid and billed by the hour", () => {
  it("marks Hospital at Home and Drive Time as hourly, logged in 15-minute steps", async () => {
    const res = await api("/visit-types");
    expect(res.status).toBe(200);
    const hah = res.body.find((t: any) => t.key === "hospital-at-home");
    const drive = res.body.find((t: any) => t.key === "drive-time");
    expect(hah.billingUnit).toBe("increment");
    expect(hah.incrementMinutes).toBe(15);
    expect(drive.billingUnit).toBe("increment");
    expect(drive.incrementMinutes).toBe(15);
  });

  it("bills a half hour of Hospital at Home as half an hour, not two blocks", async () => {
    // Hospital at Home for an RN bills $84 an HOUR on the seeded matrix, and
    // the entry stores two 15-minute blocks. The invoice has to show 0.5 x $84
    // = $42, exactly like the Hospital-at-Home column on Molly's
    // reconciliation sheet. Billing the block count instead is $168 — 4x.
    await createApproved({
      date: "2029-04-12",
      visitType: "hospital-at-home",
      quantity: 2,
    });
    const invoice = await asAdmin(() =>
      api(`/reports/invoice?clientId=${ST_LUKES}&start=${START}&end=${END}`),
    );
    const line = invoice.body.lines.find((l: any) =>
      l.description.includes("Hospital at Home"),
    );
    expect(line.qty).toBe(0.5);
    expect(line.rate).toBe(84);
    expect(line.amount).toBeCloseTo(42, 2);
    await cleanup();
  });

  it("pays an hour and a half of Hospital at Home at Molly's hourly rate", async () => {
    // Six 15-minute blocks x $67.20/hr = $100.80, the figure her RN payroll
    // sheet produces for 1.5 in the Non-visit/HAH column. A weekday, so St.
    // Luke's +10% weekend/holiday multiplier stays out of the number.
    await createApproved({
      date: "2029-04-16",
      visitType: "hospital-at-home",
      quantity: 6,
    });
    const payroll = await asAdmin(() =>
      api(`/reports/payroll?start=${START}&end=${END}`),
    );
    const emp = payroll.body.employees.find((e: any) => e.employeeId === RN_EMPLOYEE);
    const line = emp.lines.find((l: any) => l.visitType === "hospital-at-home");
    expect(line.basePay).toBeCloseTo(100.8, 2);
    await cleanup();
  });

  it("bills and pays a nurse's drive time at the Hospital at Home rate", async () => {
    // Molly: drive time on Hospital at Home or hospice work is billed at the
    // same rate, in 15-minute steps, on its own invoice line. Half an hour for
    // an RN pays 0.5 x $67.20 and bills 0.5 x $84.
    // Drive time only bills alongside Hospital at Home or hospice work, so
    // the day has to carry the visit that earns it.
    await createApproved({
      date: "2029-04-17",
      visitType: "hospital-at-home",
      quantity: 4,
    });
    await createApproved({
      date: "2029-04-17",
      visitType: "drive-time",
      quantity: 2,
    });
    const payroll = await asAdmin(() =>
      api(`/reports/payroll?start=${START}&end=${END}`),
    );
    const emp = payroll.body.employees.find((e: any) => e.employeeId === RN_EMPLOYEE);
    const payLine = emp.lines.find((l: any) => l.visitType === "drive-time");
    expect(payLine.basePay).toBeCloseTo(33.6, 2);
    expect(payLine.missingRate).toBe(false);

    const invoice = await asAdmin(() =>
      api(`/reports/invoice?clientId=${ST_LUKES}&start=${START}&end=${END}`),
    );
    const billLine = invoice.body.lines.find((l: any) =>
      l.description.includes("Drive time"),
    );
    expect(billLine.qty).toBe(0.5);
    expect(billLine.rate).toBe(84);
    expect(billLine.amount).toBeCloseTo(42, 2);
    expect(billLine.missingRate).toBeFalsy();
    await cleanup();
  });

  it("pays a therapist's drive time at the therapy Hospital at Home rate", async () => {
    // Any discipline doing Hospital at Home or hospice can claim drive time.
    // An hour for a PT pays $75.20 and bills $94.
    await createApproved({
      employeeId: PT_EMPLOYEE,
      date: "2029-04-18",
      visitType: "hospital-at-home",
      quantity: 4,
    });
    await createApproved({
      employeeId: PT_EMPLOYEE,
      date: "2029-04-18",
      visitType: "drive-time",
      quantity: 4,
    });
    const payroll = await asAdmin(() =>
      api(`/reports/payroll?start=${START}&end=${END}`),
    );
    const emp = payroll.body.employees.find((e: any) => e.employeeId === PT_EMPLOYEE);
    const payLine = emp.lines.find((l: any) => l.visitType === "drive-time");
    expect(payLine.basePay).toBeCloseTo(75.2, 2);

    const invoice = await asAdmin(() =>
      api(`/reports/invoice?clientId=${ST_LUKES}&start=${START}&end=${END}`),
    );
    const billLine = invoice.body.lines.find((l: any) =>
      l.description.includes("Drive time"),
    );
    expect(billLine.qty).toBe(1);
    expect(billLine.rate).toBe(94);
    expect(billLine.amount).toBeCloseTo(94, 2);
    await cleanup();
  });

  it("bills and pays non-visit time by the hour", async () => {
    // Molly's invoice 1189 bills non-visit and Hospital at Home on one hourly
    // line ("NV/H@H 5.5 x $84"), and her PT payroll sample pays a quarter hour
    // as $18.80. An hour of RN non-visit pays $67.20 and bills $84.
    await createApproved({
      date: "2029-04-19",
      visitType: "non-visit",
      quantity: 4,
    });
    const payroll = await asAdmin(() =>
      api(`/reports/payroll?start=${START}&end=${END}`),
    );
    const emp = payroll.body.employees.find((e: any) => e.employeeId === RN_EMPLOYEE);
    const payLine = emp.lines.find((l: any) => l.visitType === "non-visit");
    expect(payLine.basePay).toBeCloseTo(67.2, 2);

    const invoice = await asAdmin(() =>
      api(`/reports/invoice?clientId=${ST_LUKES}&start=${START}&end=${END}`),
    );
    const billLine = invoice.body.lines.find((l: any) =>
      l.description.includes("Non-visit"),
    );
    expect(billLine.qty).toBe(1);
    expect(billLine.rate).toBe(84);
    expect(billLine.amount).toBeCloseTo(84, 2);
    await cleanup();
  });

  it("names the block when the count is not a whole number", async () => {
    const res = await post("/time-entries", {
      employeeId: RN_EMPLOYEE,
      clientId: ST_LUKES,
      date: "2029-04-13",
      visitType: "hospital-at-home",
      quantity: 2.5,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/15-minute blocks/);
  });
});

describe("mileage entered for a date range", () => {
  it("accepts a mileage-only entry covering two weeks", async () => {
    const entry = await createApproved({
      date: "2029-04-16",
      endDate: "2029-04-27",
      mileage: 210,
    });
    expect(entry.endDate).toBe("2029-04-27");
    expect(entry.visitType).toBeUndefined();

    const invoice = await asAdmin(() =>
      api(`/reports/invoice?clientId=${ST_LUKES}&start=${START}&end=${END}`),
    );
    const line = invoice.body.lines.find((l: any) => l.kind === "mileage");
    expect(line.qty).toBeCloseTo(210, 2);
    // St. Luke's bills mileage at 0.725; the employee is reimbursed 0.65.
    expect(line.amount).toBeCloseTo(152.25, 2);
    // The description has to span the period, not claim a single day.
    expect(line.description).toContain("4/16-4/27/29");

    // Payroll reimburses the whole range's miles at the employee's own rate.
    // The rate itself is read rather than hardcoded: it is effective-dated
    // data Molly can change, and this test is about the 210 miles all being
    // counted, not about today's cents-per-mile.
    const rates = await asAdmin(() => api("/employee-rates"));
    const mileageRate = rates.body.find(
      (r: { employeeId: string }) => r.employeeId === RN_EMPLOYEE,
    ).mileageRate;
    const payroll = await asAdmin(() => api(`/reports/payroll?start=${START}&end=${END}`));
    const employee = payroll.body.employees.find(
      (e: { employeeId: string }) => e.employeeId === RN_EMPLOYEE,
    );
    expect(employee.mileagePay).toBeCloseTo(210 * mileageRate, 2);
    await cleanup();
  });

  it("refuses a range on anything but a mileage-only entry", async () => {
    const withVisit = await post("/time-entries", {
      employeeId: RN_EMPLOYEE,
      clientId: ST_LUKES,
      date: "2029-04-16",
      endDate: "2029-04-27",
      visitType: "eval",
      mileage: 40,
    });
    expect(withVisit.status).toBe(400);
    expect(withVisit.body.message).toMatch(/only a mileage entry/i);
  });

  it("refuses a range that ends before it starts", async () => {
    const backwards = await post("/time-entries", {
      employeeId: RN_EMPLOYEE,
      clientId: ST_LUKES,
      date: "2029-04-20",
      endDate: "2029-04-10",
      mileage: 40,
    });
    expect(backwards.status).toBe(400);
    expect(backwards.body.message).toMatch(/before the start/i);
  });

  it("still refuses an entry with no visit, no hours and no mileage", async () => {
    const empty = await post("/time-entries", {
      employeeId: RN_EMPLOYEE,
      clientId: ST_LUKES,
      date: "2029-04-20",
    });
    expect(empty.status).toBe(400);
  });
});

describe("visit types narrowed to a discipline", () => {
  it("scopes the discipline-named types and leaves the shared ones open", async () => {
    const res = await api("/visit-types");
    const byKey = new Map(res.body.map((t: any) => [t.key, t]));
    // "Skilled Nursing" and "Physical Therapy" are the same visit for a
    // different profession — an RN should never be offered the PT one.
    expect((byKey.get("skilled-nursing") as any).disciplines).toEqual(["RN", "LPN"]);
    expect((byKey.get("physical-therapy") as any).disciplines).toEqual(["PT", "PTA"]);
    expect((byKey.get("speech-therapy") as any).disciplines).toEqual(["SLP"]);
    // Shared visits stay open to everyone.
    expect((byKey.get("eval") as any).disciplines).toEqual([]);
    expect((byKey.get("soc") as any).disciplines).toEqual([]);
  });

  it("lists the disciplines catalog without a session", async () => {
    const res = await api("/disciplines");
    expect(res.status).toBe(200);
    const keys = res.body.map((d: any) => d.key);
    expect(keys).toEqual(expect.arrayContaining(["RN", "PT", "OT", "SLP", "PTA", "LPN"]));
  });

  it("rejects a discipline that isn't in the catalog", async () => {
    const res = await asAdmin(() =>
      patch("/visit-types/eval", { disciplines: ["NOT-A-DISCIPLINE"] }),
    );
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Unknown discipline/i);
  });
});

describe("changing an employee's discipline", () => {
  it("re-stamps waiting entries but never approved ones", async () => {
    // One approved (already paid and invoiced as an RN) and one still waiting.
    const approved = await createApproved({ date: "2029-04-23", visitType: "eval" });
    const waiting = await post("/time-entries", {
      employeeId: RN_EMPLOYEE,
      clientId: ST_LUKES,
      date: "2029-04-24",
      visitType: "eval",
    });
    expect(waiting.status).toBe(201);
    createdEntryIds.push(Number(waiting.body.id));

    const res = await asAdmin(() =>
      patch(`/employees/${RN_EMPLOYEE}/discipline`, { discipline: "LPN" }),
    );
    expect(res.status).toBe(200);
    expect(res.body.employee.role).toBe("LPN");
    expect(res.body.restampedEntryCount).toBe(1);

    const rows = await db
      .select()
      .from(timeEntriesTable)
      .where(inArray(timeEntriesTable.id, [Number(approved.id), Number(waiting.body.id)]));
    const approvedRow = rows.find((r) => String(r.id) === String(approved.id));
    const waitingRow = rows.find((r) => String(r.id) === String(waiting.body.id));
    expect(approvedRow!.employeeRole).toBe("RN"); // history is not rewritten
    expect(waitingRow!.employeeRole).toBe("LPN");

    await asAdmin(() => patch(`/employees/${RN_EMPLOYEE}/discipline`, { discipline: "RN" }));
    await cleanup();
  });

  it("refuses a discipline that isn't in the catalog", async () => {
    const res = await asAdmin(() =>
      patch(`/employees/${RN_EMPLOYEE}/discipline`, { discipline: "Rn " }),
    );
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/discipline list/i);
  });
});
