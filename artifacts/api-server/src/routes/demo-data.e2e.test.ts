// End-to-end tests for the expanded practice (demo) data loader: one click
// fills every feature — contact info, join request, billing addresses, rate
// history, onboarding, two months of entries, feedback, and a recorded
// practice invoice — and one click removes it all without touching real data.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "node:http";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  clientsTable,
  employeesTable,
  employeeLinkRequestsTable,
  clientRatesTable,
  employeeRatesTable,
  timeEntriesTable,
  onboardingItemsTable,
  feedbackTable,
  qboSentInvoicesTable,
} from "@workspace/db";

// Pretend QuickBooks is connected and fake the QBO API wrappers, so the
// sandbox-mode practice send below can go end-to-end without external calls.
vi.mock("../lib/qbo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/qbo")>();
  return {
    ...actual,
    getValidAccess: vi.fn(async () => ({ accessToken: "fake-token", realmId: "fake-realm" })),
  };
});
let qboCreatedCount = 0;
vi.mock("../lib/qbo-invoice", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/qbo-invoice")>();
  return {
    ...actual,
    findOrCreateCustomer: vi.fn(async (_a: unknown, name: string) => ({ value: "cust-1", name })),
    findOrCreateItem: vi.fn(async (_a: unknown, name: string) => ({ value: "item-1", name })),
    createQboInvoice: vi.fn(async () => {
      qboCreatedCount += 1;
      return { id: `qbo-demo-inv-${qboCreatedCount}`, docNumber: `${2040 + qboCreatedCount}` };
    }),
  };
});

const { default: app } = await import("../app");

let server: Server;
let baseUrl: string;

// A real (non-demo) trio that must survive demo removal untouched.
const REAL_CLIENT_ID = "e2e-demo-real-client";
const REAL_EMPLOYEE_ID = "e2e-demo-real-employee";

async function cleanupReal() {
  await db.delete(timeEntriesTable).where(eq(timeEntriesTable.employeeId, REAL_EMPLOYEE_ID));
  await db.delete(clientsTable).where(eq(clientsTable.id, REAL_CLIENT_ID));
  await db.delete(employeesTable).where(eq(employeesTable.id, REAL_EMPLOYEE_ID));
}

beforeAll(async () => {
  await cleanupReal();
  await db.insert(clientsTable).values({ id: REAL_CLIENT_ID, name: "Real Client Demo E2E" });
  await db.insert(employeesTable).values({ id: REAL_EMPLOYEE_ID, name: "Real Employee Demo E2E", role: "RN" });
  await db.insert(timeEntriesTable).values({
    employeeId: REAL_EMPLOYEE_ID,
    employeeName: "Real Employee Demo E2E",
    employeeRole: "RN",
    clientId: REAL_CLIENT_ID,
    clientName: "Real Client Demo E2E",
    // An old, otherwise-unused month so concurrent report e2e files (which
    // each own a billing month) never see this entry.
    date: "2023-11-07",
    hours: 5,
    status: "approved",
    approvedAt: new Date(),
  });
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address();
  if (address == null || typeof address === "string") throw new Error("No server port");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await cleanupReal();
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await pool.end();
});

async function api(method: string, path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}/api${path}`, { method });
  return { status: res.status, body: await res.json() };
}

const DEMO_EMPLOYEE_IDS = ["demo-emp-1", "demo-emp-2", "demo-emp-3"];
const DEMO_CLIENT_IDS = ["demo-client-1", "demo-client-2"];

describe("expanded practice data", () => {
  it("loading fills every feature", async () => {
    // Start from a clean slate in case a previous run left demo data.
    await api("DELETE", "/demo-data");

    const loaded = await api("POST", "/demo-data");
    expect(loaded.status).toBe(200);
    expect(loaded.body.loaded).toBe(true);
    expect(loaded.body.clientCount).toBe(2);
    expect(loaded.body.employeeCount).toBe(3);
    expect(loaded.body.entryCount).toBe(22); // 13 prior month + 9 current

    // Employees: contact info, one signed-in, one with sign-in disabled.
    const employees = await db
      .select()
      .from(employeesTable)
      .where(inArray(employeesTable.id, DEMO_EMPLOYEE_IDS));
    const byId = new Map(employees.map((e) => [e.id, e]));
    expect(byId.get("demo-emp-1")?.phone).toBeTruthy();
    expect(byId.get("demo-emp-1")?.contactEmail).toBeTruthy();
    expect(byId.get("demo-emp-1")?.address).toBeTruthy();
    expect(byId.get("demo-emp-1")?.email).toContain("practice-demo.example.com");
    expect(byId.get("demo-emp-2")?.signInEnabled).toBe(false);
    expect(byId.get("demo-emp-3")?.email).toBeNull();

    // Pending join request for the unclaimed demo employee.
    const linkRequests = await db
      .select()
      .from(employeeLinkRequestsTable)
      .where(inArray(employeeLinkRequestsTable.employeeId, DEMO_EMPLOYEE_IDS));
    expect(linkRequests.length).toBe(1);
    expect(linkRequests[0].employeeId).toBe("demo-emp-3");

    // Clients have billing details.
    const clients = await db
      .select()
      .from(clientsTable)
      .where(inArray(clientsTable.id, DEMO_CLIENT_IDS));
    for (const c of clients) {
      expect(c.billingContact).toBeTruthy();
      expect(c.billingAddress).toBeTruthy();
    }

    // Rate history: two effective dates per client visit-type and employee.
    const clientRates = await db
      .select()
      .from(clientRatesTable)
      .where(eq(clientRatesTable.clientId, "demo-client-1"));
    expect(clientRates.length).toBe(10); // 5 visit types x 2 dates
    const employeeRates = await db
      .select()
      .from(employeeRatesTable)
      .where(eq(employeeRatesTable.employeeId, "demo-emp-1"));
    expect(employeeRates.length).toBe(2);

    // Onboarding progress, feedback, and the practice sent invoice.
    const onboarding = await db
      .select()
      .from(onboardingItemsTable)
      .where(eq(onboardingItemsTable.employeeId, "demo-emp-3"));
    expect(onboarding.length).toBeGreaterThan(0);
    const feedback = await db
      .select()
      .from(feedbackTable)
      .where(eq(feedbackTable.isDemo, true));
    expect(feedback.length).toBe(2);
    const sentInvoices = await db
      .select()
      .from(qboSentInvoicesTable)
      .where(eq(qboSentInvoicesTable.isDemo, true));
    expect(sentInvoices.length).toBe(1);
    expect(sentInvoices[0].docNumber).toBe("DEMO-1001");

    // Entries cover both statuses and prior + current month features.
    const entries = await db
      .select()
      .from(timeEntriesTable)
      .where(eq(timeEntriesTable.isDemo, true));
    expect(entries.some((e) => e.status === "submitted")).toBe(true);
    expect(entries.some((e) => e.status === "approved")).toBe(true);
    expect(entries.some((e) => e.isHoliday)).toBe(true);
    expect(entries.some((e) => (e.perDiem ?? 0) > 0)).toBe(true);
    expect(entries.some((e) => (e.mileage ?? 0) > 0)).toBe(true);
    expect(entries.some((e) => e.visitType === "speech-therapy")).toBe(true);
  });

  it("loading twice does not duplicate anything", async () => {
    const again = await api("POST", "/demo-data");
    expect(again.status).toBe(200);
    expect(again.body.entryCount).toBe(22);
    const feedback = await db
      .select()
      .from(feedbackTable)
      .where(eq(feedbackTable.isDemo, true));
    expect(feedback.length).toBe(2);
    const sentInvoices = await db
      .select()
      .from(qboSentInvoicesTable)
      .where(eq(qboSentInvoicesTable.isDemo, true));
    expect(sentInvoices.length).toBe(1);
    const linkRequests = await db
      .select()
      .from(employeeLinkRequestsTable)
      .where(inArray(employeeLinkRequestsTable.employeeId, DEMO_EMPLOYEE_IDS));
    expect(linkRequests.length).toBe(1);
    const clientRates = await db
      .select()
      .from(clientRatesTable)
      .where(inArray(clientRatesTable.clientId, DEMO_CLIENT_IDS));
    expect(clientRates.length).toBe(20);
  });

  it("demo clients can never be sent to a real QuickBooks account", async () => {
    // Pin to non-sandbox: the workspace may have QBO_ENV=sandbox set, which
    // deliberately relaxes this block (covered in qbo-demo-sandbox.e2e.test.ts).
    const savedEnv = process.env["QBO_ENV"];
    delete process.env["QBO_ENV"];
    try {
      const res = await fetch(`${baseUrl}/api/qbo/invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: "demo-client-1", start: "2023-10-01", end: "2023-10-31" }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { message: string };
      expect(body.message).toContain("Demo clients can't be sent to a real QuickBooks account");
    } finally {
      if (savedEnv === undefined) delete process.env["QBO_ENV"];
      else process.env["QBO_ENV"] = savedEnv;
    }
  });

  it("demo clients CAN be sent when pointed at a sandbox QuickBooks account", async () => {
    const savedEnv = process.env["QBO_ENV"];
    process.env["QBO_ENV"] = "sandbox";
    try {
      // Bill everything the demo data seeded, whatever months it landed in.
      // confirmDuplicate skips the repeat-send warning (a practice invoice
      // record is part of the seeded data).
      const before = qboCreatedCount;
      const res = await fetch(`${baseUrl}/api/qbo/invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: "demo-client-1",
          start: "2020-01-01",
          end: "2030-12-31",
          confirmDuplicate: true,
        }),
      });
      const body = (await res.json()) as Record<string, unknown>;
      expect(res.status).toBe(200);
      expect(body["qboInvoiceId"]).toBe(`qbo-demo-inv-${before + 1}`);

      // The recorded send stays labeled as practice data, so it's removed
      // with the rest of the demo set.
      const rows = await db
        .select()
        .from(qboSentInvoicesTable)
        .where(eq(qboSentInvoicesTable.qboInvoiceId, `qbo-demo-inv-${before + 1}`));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.isDemo).toBe(true);
    } finally {
      if (savedEnv === undefined) delete process.env["QBO_ENV"];
      else process.env["QBO_ENV"] = savedEnv;
    }
  });

  it("reload after the demo join request was approved doesn't create an invalid new request", async () => {
    // Simulate an approved request: Riley got linked, the request is gone.
    await db
      .delete(employeeLinkRequestsTable)
      .where(eq(employeeLinkRequestsTable.employeeId, "demo-emp-3"));
    await db
      .update(employeesTable)
      .set({ email: "riley.linked.demo@practice-demo.example.com" })
      .where(eq(employeesTable.id, "demo-emp-3"));

    const reload = await api("POST", "/demo-data");
    expect(reload.status).toBe(200);
    const requests = await db
      .select()
      .from(employeeLinkRequestsTable)
      .where(inArray(employeeLinkRequestsTable.employeeId, DEMO_EMPLOYEE_IDS));
    expect(requests.length).toBe(0); // no bogus claim on a linked profile
  });

  it("removal clears every demo record and leaves real data alone", async () => {
    const removed = await api("DELETE", "/demo-data");
    expect(removed.status).toBe(200);
    expect(removed.body.loaded).toBe(false);
    expect(removed.body.entryCount).toBe(0);

    expect(
      (await db.select().from(employeesTable).where(inArray(employeesTable.id, DEMO_EMPLOYEE_IDS))).length,
    ).toBe(0);
    expect(
      (await db.select().from(clientsTable).where(inArray(clientsTable.id, DEMO_CLIENT_IDS))).length,
    ).toBe(0);
    expect(
      (await db.select().from(employeeLinkRequestsTable).where(inArray(employeeLinkRequestsTable.employeeId, DEMO_EMPLOYEE_IDS))).length,
    ).toBe(0);
    expect(
      (await db.select().from(feedbackTable).where(eq(feedbackTable.isDemo, true))).length,
    ).toBe(0);
    expect(
      (await db.select().from(qboSentInvoicesTable).where(eq(qboSentInvoicesTable.isDemo, true))).length,
    ).toBe(0);
    expect(
      (await db.select().from(onboardingItemsTable).where(inArray(onboardingItemsTable.employeeId, DEMO_EMPLOYEE_IDS))).length,
    ).toBe(0);
    expect(
      (await db.select().from(clientRatesTable).where(inArray(clientRatesTable.clientId, DEMO_CLIENT_IDS))).length,
    ).toBe(0);
    expect(
      (await db.select().from(employeeRatesTable).where(inArray(employeeRatesTable.employeeId, DEMO_EMPLOYEE_IDS))).length,
    ).toBe(0);

    // The real trio is untouched.
    const [realClient] = await db.select().from(clientsTable).where(eq(clientsTable.id, REAL_CLIENT_ID));
    const [realEmployee] = await db.select().from(employeesTable).where(eq(employeesTable.id, REAL_EMPLOYEE_ID));
    const realEntries = await db.select().from(timeEntriesTable).where(eq(timeEntriesTable.employeeId, REAL_EMPLOYEE_ID));
    expect(realClient).toBeTruthy();
    expect(realEmployee).toBeTruthy();
    expect(realEntries.length).toBe(1);
  });
});
