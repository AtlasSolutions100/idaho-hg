// End-to-end tests for the duplicate-send guard on POST /api/qbo/invoice:
// a first send records a row, a repeat send for the same client + period is
// blocked with the prior send's details, a confirmed repeat goes through,
// a different period is unaffected, and two parallel sends of the same
// client + period cannot both slip through unrecorded.
//
// The QuickBooks network layer is mocked (getValidAccess + the QBO API
// wrappers) so no external calls are made; everything else — HTTP stack,
// validation, database recording, advisory locking — is real.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
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
  qboSentInvoicesTable,
} from "@workspace/db";

// Roster writes (POST /employees) are admin-only now, so this file performs
// its roster setup as Molly and everything else anonymously. Clerk is mocked
// at the @clerk/express boundary.
const QBO_ADMIN_EMAIL = "admin-qbo-dup-e2e@example.com";
process.env.ADMIN_EMAIL = QBO_ADMIN_EMAIL;
const mockSession: { email: string | null } = { email: null };
vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: () => (mockSession.email ? { userId: "user_qbo_dup_e2e" } : null),
  clerkClient: {
    users: {
      getUser: async () => ({
        primaryEmailAddress: { emailAddress: mockSession.email },
        emailAddresses: [{ emailAddress: mockSession.email }],
      }),
      getUserList: async () => ({ data: [{ id: "user_qbo_dup_e2e" }] }),
      createUser: async () => ({ id: "user_qbo_dup_e2e" }),
    },
    sessions: {
      getSessionList: async () => ({ data: [] }),
      revokeSession: async () => ({}),
    },
  },
}));

// Pretend QuickBooks is connected.
vi.mock("../lib/qbo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/qbo")>();
  return {
    ...actual,
    getValidAccess: vi.fn(async () => ({ accessToken: "fake-token", realmId: "fake-realm" })),
  };
});

// Fake the QBO API: creating an invoice returns a fresh id each time, with a
// small delay so the parallel-send race is realistic.
let createdCount = 0;
vi.mock("../lib/qbo-invoice", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/qbo-invoice")>();
  return {
    ...actual,
    findOrCreateCustomer: vi.fn(async (_a: unknown, name: string) => ({ value: "cust-1", name })),
    findOrCreateItem: vi.fn(async (_a: unknown, name: string) => ({ value: "item-1", name })),
    createQboInvoice: vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 150));
      createdCount += 1;
      return { id: `qbo-inv-${createdCount}`, docNumber: `${1040 + createdCount}` };
    }),
  };
});

import app from "../app";

let server: Server;
let baseUrl: string;

const runTag = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const clientName = `E2E QBO Dup Client ${runTag}`;
const employeeName = `E2E QBO Dup Nurse ${runTag}`;

let clientId = "";
let employeeId = "";

// Unique billing month for this file (see e2e test isolation note): May 2027.
const START = "2027-05-01";
const END = "2027-05-31";
const START2 = "2027-05-01";
const END2 = "2027-05-15"; // different period (same client)

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

// Roster/rate writes, approvals, and every QBO endpoint are admin-only; run
// them as Molly. Time-entry creation stays anonymous (the admin email isn't a
// roster employee, so creating an entry as admin would be rejected).
// Fixtures are built by POSTing time entries, which now requires a session.
// Molly's is the one that may file hours for another employee, so this suite
// runs as her throughout and asAdmin restores to her rather than to nobody.
mockSession.email = QBO_ADMIN_EMAIL;
const asAdmin = async <T>(fn: () => Promise<T>): Promise<T> => {
  mockSession.email = QBO_ADMIN_EMAIL;
  try {
    return await fn();
  } finally {
    mockSession.email = QBO_ADMIN_EMAIL;
  }
};

const sendInvoice = (body: Record<string, unknown>) =>
  asAdmin(() => post("/qbo/invoice", body));

async function recordedSends(start: string, end: string) {
  const rows = await db
    .select()
    .from(qboSentInvoicesTable)
    .where(eq(qboSentInvoicesTable.clientId, clientId));
  return rows.filter((r) => r.periodStart === start && r.periodEnd === end);
}

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address();
  if (address == null || typeof address === "string") throw new Error("No server port");
  baseUrl = `http://127.0.0.1:${address.port}`;

  // Seed: a client with an hourly rate, an employee, and approved entries in
  // the billing month.
  const clientRes = await asAdmin(() =>
    post("/clients", {
      name: clientName,
      visitType: "skilled-nursing",
      rate: 90,
    }),
  );
  expect(clientRes.status).toBe(201);
  clientId = clientRes.body.id;
  // This test posts visit-type entries, so mark the client as visit-billing.
  await db
    .update(clientsTable)
    .set({ billsByVisitType: true })
    .where(eq(clientsTable.id, clientId));
  const hourly = await asAdmin(() =>
    post("/client-rates", {
      clientId,
      rateType: "hourly",
      rate: 60,
      effectiveDate: "2027-01-01",
    }),
  );
  expect(hourly.status).toBe(201);

  const empRes = await asAdmin(() =>
    post("/employees", {
      name: employeeName,
      role: "RN",
      hourlyRate: 40,
      visitRate: 70,
      mileageRate: 0.65,
      perDiemRate: 45,
      weekendMultiplier: 1.5,
      holidayMultiplier: 2,
    }),
  );
  expect(empRes.status).toBe(201);
  employeeId = empRes.body.id;

  // 2027-05-20 exists so the second-half period used by the parallel-send
  // test has something billable too.
  for (const date of ["2027-05-04", "2027-05-12", "2027-05-20"]) {
    const entry = await post("/time-entries", {
      employeeId,
      clientId,
      date,
      hours: 4,
      isWeekend: false,
      isHoliday: false,
    });
    expect(entry.status).toBe(201);
    const approve = await asAdmin(() => post(`/time-entries/${entry.body.id}/approve`));
    expect(approve.status).toBe(200);
  }
});

afterAll(async () => {
  if (clientId) {
    await db.delete(qboSentInvoicesTable).where(eq(qboSentInvoicesTable.clientId, clientId));
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

describe("POST /qbo/invoice duplicate-send guard", () => {
  it("first send succeeds with a single click and records a row", async () => {
    const res = await sendInvoice({ clientId, start: START, end: END });
    expect(res.status).toBe(200);
    expect(res.body.qboInvoiceId).toBeTruthy();
    expect(res.body.docNumber).toBeTruthy();

    const rows = await recordedSends(START, END);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.qboInvoiceId).toBe(res.body.qboInvoiceId);
    expect(rows[0]!.docNumber).toBe(res.body.docNumber);
    expect(rows[0]!.sentAt).toBeInstanceOf(Date);
  });

  it("a repeat send is blocked with the prior send's details", async () => {
    const before = createdCount;
    const res = await sendInvoice({ clientId, start: START, end: END });
    expect(res.status).toBe(409);
    expect(res.body.alreadySent).toBe(true);
    expect(res.body.message).toMatch(/already sent to QuickBooks/i);
    expect(res.body.message).toContain(`#${res.body.previousDocNumber}`);
    expect(res.body.previousQboInvoiceId).toBeTruthy();
    expect(res.body.previousSentAt).toBeTruthy();
    // Nothing new was created in QuickBooks and nothing new was recorded.
    expect(createdCount).toBe(before);
    expect(await recordedSends(START, END)).toHaveLength(1);
  });

  it("a confirmed repeat (confirmDuplicate) sends anyway and records again", async () => {
    const res = await sendInvoice({ clientId, start: START, end: END, confirmDuplicate: true });
    expect(res.status).toBe(200);
    const rows = await recordedSends(START, END);
    expect(rows).toHaveLength(2);
  });

  it("a different period for the same client is a plain first-time send", async () => {
    const res = await sendInvoice({ clientId, start: START2, end: END2 });
    expect(res.status).toBe(200);
    expect(await recordedSends(START2, END2)).toHaveLength(1);
  });

  it("two parallel sends of the same client + period cannot both slip through", async () => {
    // Fresh period so neither request sees a pre-existing row up front.
    const start = "2027-05-16";
    const end = "2027-05-31";
    const before = createdCount;
    const [a, b] = await Promise.all([
      sendInvoice({ clientId, start, end }),
      sendInvoice({ clientId, start, end }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const blocked = a.status === 409 ? a : b;
    expect(blocked.body.alreadySent).toBe(true);
    // Exactly one QuickBooks invoice was created and exactly one row recorded.
    expect(createdCount).toBe(before + 1);
    expect(await recordedSends(start, end)).toHaveLength(1);
  });
});

describe("GET /qbo/sent-invoices", () => {
  const get = (query: Record<string, string>) =>
    asAdmin(() => api(`/qbo/sent-invoices?${new URLSearchParams(query)}`));

  it("returns sent=false for a period never sent", async () => {
    const res = await get({ clientId, start: "2027-05-02", end: "2027-05-03" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: false, sentAt: null, docNumber: null, qboInvoiceId: null });
  });

  it("returns the newest recorded send for a sent period", async () => {
    // START/END has two recorded sends by now (original + confirmed repeat).
    const rows = await recordedSends(START, END);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const newest = [...rows].sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())[0]!;

    const res = await get({ clientId, start: START, end: END });
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(true);
    expect(res.body.qboInvoiceId).toBe(newest.qboInvoiceId);
    expect(res.body.docNumber).toBe(newest.docNumber);
    expect(res.body.sentAt).toBe(newest.sentAt.toISOString());
  });

  it("rejects missing or invalid parameters", async () => {
    expect((await get({ start: START, end: END, clientId: "" })).status).toBe(400);
    expect((await get({ clientId, start: "not-a-date", end: END })).status).toBe(400);
    expect((await get({ clientId, start: END, end: START })).status).toBe(400);
  });
});
