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

describe("Molly can turn an employee's sign-in off and on", () => {
  it("turning sign-in off blocks the employee with a distinct friendly message", async () => {
    // Molly's admin app carries no employee session.
    mockState.email = null;
    const off = await api("PATCH", `/employees/${EMPLOYEE_ID}/sign-in-access`, {
      signInEnabled: false,
    });
    expect(off.status).toBe(200);
    expect(off.body.signInEnabled).toBe(false);

    mockState.email = EMAIL;

    const me = await api("GET", "/me");
    expect(me.status).toBe(403);
    expect(me.body.code).toBe("SIGN_IN_DISABLED");
    expect(me.body.message).toContain("turned off");

    const entry = await api("POST", "/time-entries", {
      ...timeEntryBody(),
      date: "2024-02-15",
    });
    expect(entry.status).toBe(403);
    expect(entry.body.code).toBe("SIGN_IN_DISABLED");
    expect(entry.body.message).toContain("turned off");

    const list = await api("GET", "/time-entries");
    expect(list.status).toBe(403);
  });

  it("turning sign-in back on restores access", async () => {
    mockState.email = null;
    const on = await api("PATCH", `/employees/${EMPLOYEE_ID}/sign-in-access`, {
      signInEnabled: true,
    });
    expect(on.status).toBe(200);
    expect(on.body.signInEnabled).toBe(true);

    mockState.email = EMAIL;
    const me = await api("GET", "/me");
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(EMPLOYEE_ID);
  });

  it("disable is independent of removal: restoring a removed employee keeps sign-in off", async () => {
    // Disable, then remove, then restore — the deliberate disable must survive.
    mockState.email = null;
    await api("PATCH", `/employees/${EMPLOYEE_ID}/sign-in-access`, {
      signInEnabled: false,
    });
    await api("DELETE", `/employees/${EMPLOYEE_ID}`);
    await db
      .update(employeesTable)
      .set({ active: true })
      .where(eq(employeesTable.id, EMPLOYEE_ID));

    mockState.email = EMAIL;
    const me = await api("GET", "/me");
    expect(me.status).toBe(403);
    expect(me.body.message).toContain("turned off");

    // Re-enable (sessionless, like the admin app) so the row is left clean.
    mockState.email = null;
    const on = await api("PATCH", `/employees/${EMPLOYEE_ID}/sign-in-access`, {
      signInEnabled: true,
    });
    expect(on.status).toBe(200);
    mockState.email = EMAIL;
    const meAgain = await api("GET", "/me");
    expect(meAgain.status).toBe(200);
  });

  it("a signed-in employee cannot flip sign-in access (their own or anyone's)", async () => {
    mockState.email = EMAIL;

    // Try to disable/re-enable while carrying an employee session.
    const attempt = await api("PATCH", `/employees/${EMPLOYEE_ID}/sign-in-access`, {
      signInEnabled: false,
    });
    expect(attempt.status).toBe(403);
    expect(attempt.body.message).toContain("Only Molly");

    // A disabled employee's session can't re-enable itself either.
    await db
      .update(employeesTable)
      .set({ signInEnabled: false })
      .where(eq(employeesTable.id, EMPLOYEE_ID));
    const reEnable = await api("PATCH", `/employees/${EMPLOYEE_ID}/sign-in-access`, {
      signInEnabled: true,
    });
    expect(reEnable.status).toBe(403);

    // Value must be unchanged by the blocked attempts.
    const [row] = await db
      .select()
      .from(employeesTable)
      .where(eq(employeesTable.id, EMPLOYEE_ID));
    expect(row.signInEnabled).toBe(false);

    // Restore clean state: drop the session (admin app has none) and re-enable.
    mockState.email = null;
    const on = await api("PATCH", `/employees/${EMPLOYEE_ID}/sign-in-access`, {
      signInEnabled: true,
    });
    expect(on.status).toBe(200);
    mockState.email = EMAIL;
  });

  it("rejects an invalid body and unknown employee", async () => {
    mockState.email = null;
    const bad = await api("PATCH", `/employees/${EMPLOYEE_ID}/sign-in-access`, {
      signInEnabled: "nope",
    });
    expect(bad.status).toBe(400);

    const missing = await api("PATCH", "/employees/does-not-exist/sign-in-access", {
      signInEnabled: false,
    });
    expect(missing.status).toBe(404);
  });
});
