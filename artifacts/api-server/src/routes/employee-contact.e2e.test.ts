// End-to-end tests for employee contact details (task: employee management
// page — contact info alongside login and rates).
//
// Contact writes are admin-only (they live on the roster row Molly manages);
// reads come back on the employee list. Clerk is mocked at the
// @clerk/express boundary (never global fetch).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { vi } from "vitest";
import type { Server } from "node:http";
import { eq, inArray } from "drizzle-orm";
import { db, pool, employeesTable } from "@workspace/db";

const mockState: { email: string | null } = { email: null };

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: () => (mockState.email ? { userId: "user_contact_e2e" } : null),
  clerkClient: {
    users: {
      getUser: async () => ({
        primaryEmailAddress: { emailAddress: mockState.email },
        emailAddresses: [{ emailAddress: mockState.email }],
      }),
      getUserList: async () => ({ data: [{ id: "user_contact_e2e" }] }),
      createUser: async () => ({ id: "user_contact_e2e" }),
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

const EMPLOYEE_ID = "e2e-contact-employee";
const ADMIN_EMAIL = "admin-contact-e2e@example.com";
const CREATED_NAME = "Created With Contact E2E";
process.env.ADMIN_EMAIL = ADMIN_EMAIL;

async function cleanup() {
  await db.delete(employeesTable).where(eq(employeesTable.id, EMPLOYEE_ID));
  await db.delete(employeesTable).where(eq(employeesTable.name, CREATED_NAME));
}

beforeAll(async () => {
  await cleanup();
  await db.insert(employeesTable).values([
    { id: EMPLOYEE_ID, name: "Contact E2E Person", role: "RN", email: null },
  ]);
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

async function api(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json() };
}

describe("employee contact details", () => {
  it("admin can set contact details and they come back on the employee list", async () => {
    mockState.email = ADMIN_EMAIL;
    const updated = await api("PATCH", `/employees/${EMPLOYEE_ID}/contact`, {
      phone: " (208) 555-0142 ",
      contactEmail: "Jane.Contact@Example.com",
      address: "123 Main St, Boise, ID 83702",
    });
    expect(updated.status).toBe(200);
    expect(updated.body.phone).toBe("(208) 555-0142");
    expect(updated.body.contactEmail).toBe("jane.contact@example.com");
    expect(updated.body.address).toBe("123 Main St, Boise, ID 83702");

    const list = await api("GET", "/employees");
    expect(list.status).toBe(200);
    const row = list.body.find((e: any) => e.id === EMPLOYEE_ID);
    expect(row.phone).toBe("(208) 555-0142");
    expect(row.contactEmail).toBe("jane.contact@example.com");
  });

  it("the employee list requires a session; contact details stay admin-only", async () => {
    // Anonymous callers can't see the roster at all anymore.
    mockState.email = null;
    const anon = await api("GET", "/employees");
    expect(anon.status).toBe(401);

    // A signed-in non-admin sees the list but never the personal info
    // (phone, home address) — only Molly's session sees that.
    mockState.email = "someone-else-contact-e2e@example.com";
    const outsider = await api("GET", "/employees");
    expect(outsider.status).toBe(200);
    const outsiderRow = outsider.body.find((e: any) => e.id === EMPLOYEE_ID);
    expect(outsiderRow.name).toBe("Contact E2E Person");
    expect(outsiderRow.phone).toBeUndefined();
    expect(outsiderRow.address).toBeUndefined();
  });

  it("creating and removing employees is admin-only", async () => {
    // Plain creation (no contact info, no email) is also locked down now.
    mockState.email = null;
    const anonCreate = await api("POST", "/employees", {
      name: "Plain Creation E2E",
      role: "RN",
      hourlyRate: 40,
      visitRate: 70,
      mileageRate: 0.65,
      perDiemRate: 45,
      weekendMultiplier: 1.5,
      holidayMultiplier: 2,
    });
    expect(anonCreate.status).toBe(401);

    mockState.email = "someone-else-contact-e2e@example.com";
    const outsiderCreate = await api("POST", "/employees", {
      name: "Plain Creation E2E",
      role: "RN",
      hourlyRate: 40,
      visitRate: 70,
      mileageRate: 0.65,
      perDiemRate: 45,
      weekendMultiplier: 1.5,
      holidayMultiplier: 2,
    });
    expect(outsiderCreate.status).toBe(403);
    expect(outsiderCreate.body.message).toContain("Only an administrator");

    // Removal is admin-only too — and a rejected attempt changes nothing.
    mockState.email = null;
    const anonRemove = await api("DELETE", `/employees/${EMPLOYEE_ID}`);
    expect(anonRemove.status).toBe(401);

    mockState.email = "someone-else-contact-e2e@example.com";
    const outsiderRemove = await api("DELETE", `/employees/${EMPLOYEE_ID}`);
    expect(outsiderRemove.status).toBe(403);
    expect(outsiderRemove.body.message).toContain("Only an administrator");

    const [row] = await db
      .select()
      .from(employeesTable)
      .where(eq(employeesTable.id, EMPLOYEE_ID));
    expect(row.active).toBe(true);
  });

  it("omitted fields are unchanged; blank strings clear a field", async () => {
    mockState.email = ADMIN_EMAIL;
    const phoneOnly = await api("PATCH", `/employees/${EMPLOYEE_ID}/contact`, {
      phone: "(208) 555-9999",
    });
    expect(phoneOnly.status).toBe(200);
    expect(phoneOnly.body.phone).toBe("(208) 555-9999");
    expect(phoneOnly.body.contactEmail).toBe("jane.contact@example.com");

    const cleared = await api("PATCH", `/employees/${EMPLOYEE_ID}/contact`, {
      contactEmail: "",
      address: "",
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body.contactEmail).toBeUndefined();
    expect(cleared.body.address).toBeUndefined();
    expect(cleared.body.phone).toBe("(208) 555-9999");
  });

  it("rejects an invalid contact email and an empty update", async () => {
    mockState.email = ADMIN_EMAIL;
    const bad = await api("PATCH", `/employees/${EMPLOYEE_ID}/contact`, {
      contactEmail: "not-an-email",
    });
    expect(bad.status).toBe(400);

    const empty = await api("PATCH", `/employees/${EMPLOYEE_ID}/contact`, {});
    expect(empty.status).toBe(400);

    const missing = await api("PATCH", "/employees/does-not-exist/contact", {
      phone: "555",
    });
    expect(missing.status).toBe(404);
  });

  it("anonymous and non-admin callers cannot write contact details", async () => {
    mockState.email = null;
    const anon = await api("PATCH", `/employees/${EMPLOYEE_ID}/contact`, {
      phone: "555-0000",
    });
    expect(anon.status).toBe(401);

    mockState.email = "not-molly-contact-e2e@example.com";
    const outsider = await api("PATCH", `/employees/${EMPLOYEE_ID}/contact`, {
      phone: "555-0000",
    });
    expect(outsider.status).toBe(403);
    expect(outsider.body.message).toContain("Only an administrator");

    const [row] = await db
      .select()
      .from(employeesTable)
      .where(eq(employeesTable.id, EMPLOYEE_ID));
    expect(row.phone).toBe("(208) 555-9999");
  });

  it("creating an employee with contact info is admin-only and stores it", async () => {
    // Anonymous contact-bearing creation is rejected — contact details are
    // personal info, so writing them needs Molly's session.
    mockState.email = null;
    const anon = await api("POST", "/employees", {
      name: CREATED_NAME,
      role: "PT",
      phone: "(208) 555-7777",
      hourlyRate: 40,
      visitRate: 70,
      mileageRate: 0.65,
      perDiemRate: 45,
      weekendMultiplier: 1.5,
      holidayMultiplier: 2,
    });
    expect(anon.status).toBe(401);

    mockState.email = ADMIN_EMAIL;
    const badEmail = await api("POST", "/employees", {
      name: CREATED_NAME,
      role: "PT",
      contactEmail: "not-an-email",
      hourlyRate: 40,
      visitRate: 70,
      mileageRate: 0.65,
      perDiemRate: 45,
      weekendMultiplier: 1.5,
      holidayMultiplier: 2,
    });
    expect(badEmail.status).toBe(400);

    const created = await api("POST", "/employees", {
      name: CREATED_NAME,
      role: "PT",
      phone: "(208) 555-7777",
      contactEmail: "Created.Contact@Example.com",
      address: "456 Elm St, Boise, ID",
      hourlyRate: 40,
      visitRate: 70,
      mileageRate: 0.65,
      perDiemRate: 45,
      weekendMultiplier: 1.5,
      holidayMultiplier: 2,
    });
    expect(created.status).toBe(201);
    expect(created.body.phone).toBe("(208) 555-7777");
    expect(created.body.contactEmail).toBe("created.contact@example.com");
    expect(created.body.address).toBe("456 Elm St, Boise, ID");
  });
});
