// End-to-end test for task: removed employees must not keep mobile-app access.
//
// When Molly removes an employee (DELETE /employees/:id sets active=false),
// the roster row and Clerk account survive so the person can still complete
// the Clerk sign-in. The server must treat that session like an unknown
// email: GET /me and POST /time-entries return the friendly 403 that drives
// the "ask Molly to add you" screen. Reactivating the row (restore, task #9
// territory) must bring access back — which is why the email is kept on the
// row rather than cleared on removal.
//
// Clerk is mocked at the @clerk/express boundary (never global fetch): the
// middleware is a passthrough and getAuth/getUser return whatever session
// the test configures.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { vi } from "vitest";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import { db, pool, employeesTable, timeEntriesTable, employeeRatesTable } from "@workspace/db";

const mockState: { email: string | null } = { email: null };

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: () => (mockState.email ? { userId: "user_removed_e2e" } : null),
  clerkClient: {
    users: {
      getUser: async () => ({
        primaryEmailAddress: { emailAddress: mockState.email },
        emailAddresses: [{ emailAddress: mockState.email }],
      }),
      getUserList: async () => ({ data: [{ id: "user_removed_e2e" }] }),
      createUser: async () => ({ id: "user_removed_e2e" }),
    },
  },
}));

// Import after the mock so app picks up the mocked @clerk/express.
const { default: app } = await import("../app");

let server: Server;
let baseUrl: string;

const EMPLOYEE_ID = "e2e-removed-employee-auth";
const EMAIL = "removed-employee-e2e@example.com";

beforeAll(async () => {
  await db.delete(timeEntriesTable).where(eq(timeEntriesTable.employeeId, EMPLOYEE_ID));
  await db.delete(employeeRatesTable).where(eq(employeeRatesTable.employeeId, EMPLOYEE_ID));
  await db.delete(employeesTable).where(eq(employeesTable.id, EMPLOYEE_ID));
  await db.delete(employeesTable).where(eq(employeesTable.email, EMAIL));
  await db.insert(employeesTable).values({
    id: EMPLOYEE_ID,
    name: "Removed Auth E2E",
    role: "RN",
    email: EMAIL,
    active: true,
  });

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address();
  if (address == null || typeof address === "string") throw new Error("No server port");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await db.delete(timeEntriesTable).where(eq(timeEntriesTable.employeeId, EMPLOYEE_ID));
  await db.delete(employeesTable).where(eq(employeesTable.id, EMPLOYEE_ID));
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

function timeEntryBody() {
  return {
    employeeId: EMPLOYEE_ID,
    clientId: "1",
    // A quiet month/day unlikely to collide with other e2e files' data.
    date: "2024-02-13",
    hours: 2,
    isWeekend: false,
    isHoliday: false,
  };
}

describe("removed employees lose mobile-app access", () => {
  it("an active employee can use /me and log time", async () => {
    mockState.email = EMAIL;

    const me = await api("GET", "/me");
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(EMPLOYEE_ID);

    const entry = await api("POST", "/time-entries", timeEntryBody());
    expect(entry.status).toBe(201);
    expect(entry.body.employeeId).toBe(EMPLOYEE_ID);
  });

  it("after removal the same session gets the friendly 403 everywhere", async () => {
    const removed = await api("DELETE", `/employees/${EMPLOYEE_ID}`);
    expect(removed.status).toBe(200);
    expect(removed.body.active).toBe(false);

    const me = await api("GET", "/me");
    expect(me.status).toBe(403);
    expect(me.body.message).toContain("Ask Molly");

    const entry = await api("POST", "/time-entries", timeEntryBody());
    expect(entry.status).toBe(403);
    expect(entry.body.message).toContain("Ask Molly");

    const list = await api("GET", "/time-entries");
    expect(list.status).toBe(403);
  });

  it("restoring the employee restores app access", async () => {
    // Restore = flip active back on (what a future restore endpoint will do).
    await db
      .update(employeesTable)
      .set({ active: true })
      .where(eq(employeesTable.id, EMPLOYEE_ID));

    const me = await api("GET", "/me");
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(EMPLOYEE_ID);

    const entry = await api("POST", "/time-entries", {
      ...timeEntryBody(),
      date: "2024-02-14",
    });
    expect(entry.status).toBe(201);
  });
});
