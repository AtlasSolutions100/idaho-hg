// Who can read and write time entries.
//
// Time entries carry names, disciplines, clients, hours, mileage and per diem —
// the raw material of payroll. These endpoints used to serve and accept them
// with no session at all, so anyone with the app's link could read the whole
// company's hours and file hours under someone else's name. This suite is the
// regression net for that: every anonymous path must be refused, an employee
// must be pinned to their own rows no matter what they ask for, and only Molly
// may act across the roster.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "node:http";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  clientsTable,
  employeesTable,
  employeeLinkRequestsTable,
  timeEntriesTable,
} from "@workspace/db";

const mockState: { email: string | null } = { email: null };

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: () => (mockState.email ? { userId: "user_access_e2e" } : null),
  clerkClient: {
    users: {
      getUser: async () => ({
        primaryEmailAddress: { emailAddress: mockState.email },
        emailAddresses: [{ emailAddress: mockState.email }],
      }),
      getUserList: async () => ({ data: [{ id: "user_access_e2e" }] }),
      createUser: async () => ({ id: "user_access_e2e" }),
    },
    sessions: {
      getSessionList: async () => ({ data: [] }),
      revokeSession: async () => ({}),
    },
  },
}));

const ADMIN_EMAIL = "admin-access-e2e@example.com";
process.env.ADMIN_EMAIL = ADMIN_EMAIL;

const { default: app } = await import("../app");

let server: Server;
let baseUrl: string;

const CLIENT_ID = "e2e-access-client";
const ANA_ID = "e2e-access-ana";
const ANA_EMAIL = "ana-access-e2e@example.com";
const BEN_ID = "e2e-access-ben";
const BEN_EMAIL = "ben-access-e2e@example.com";
const WAITING_EMAIL = "waiting-access-e2e@example.com";
const BLOCKED_ID = "e2e-access-blocked";
const BLOCKED_EMAIL = "blocked-access-e2e@example.com";
const STRANGER_EMAIL = "stranger-access-e2e@example.com";

const EMPLOYEE_IDS = [ANA_ID, BEN_ID, BLOCKED_ID];

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** An hourly entry body for the shared client. */
function entryBody(employeeId: string, date: string) {
  return { employeeId, clientId: CLIENT_ID, date, timeIn: "08:00", timeOut: "12:00" };
}

async function cleanup() {
  await db.delete(timeEntriesTable).where(inArray(timeEntriesTable.employeeId, EMPLOYEE_IDS));
  await db.delete(clientsTable).where(eq(clientsTable.id, CLIENT_ID));
  await db.delete(employeesTable).where(inArray(employeesTable.id, EMPLOYEE_IDS));
  await db
    .delete(employeeLinkRequestsTable)
    .where(eq(employeeLinkRequestsTable.email, WAITING_EMAIL));
}

let anaEntryId: string;
let benEntryId: string;

beforeAll(async () => {
  await cleanup();
  await db.insert(employeesTable).values([
    { id: ANA_ID, name: "Ana Access", role: "RN", email: ANA_EMAIL },
    { id: BEN_ID, name: "Ben Access", role: "RN", email: BEN_EMAIL },
    // On the roster, but Molly turned this one's sign-in off.
    {
      id: BLOCKED_ID,
      name: "Blocked Access",
      role: "RN",
      email: BLOCKED_EMAIL,
      signInEnabled: false,
    },
  ]);
  await db.insert(clientsTable).values({ id: CLIENT_ID, name: "Access E2E Clinic" });
  // Somebody who has asked Molly to link them and is still waiting. The
  // request has to point at a real profile, so it points at Ben's; Molly
  // hasn't approved it, which is the whole point.
  await db.insert(employeeLinkRequestsTable).values({
    id: "e2e-access-waiting",
    employeeId: BEN_ID,
    email: WAITING_EMAIL,
  });

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address();
  if (address == null || typeof address === "string") throw new Error("No server port");
  baseUrl = `http://127.0.0.1:${address.port}`;

  // One entry each, filed by their own owner.
  mockState.email = ANA_EMAIL;
  const ana = await api("POST", "/time-entries", entryBody(ANA_ID, "2028-04-03"));
  expect(ana.status).toBe(201);
  anaEntryId = ana.body.id;

  mockState.email = BEN_EMAIL;
  const ben = await api("POST", "/time-entries", entryBody(BEN_ID, "2028-04-04"));
  expect(ben.status).toBe(201);
  benEntryId = ben.body.id;

  mockState.email = null;
});

afterAll(async () => {
  await cleanup();
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await pool.end();
});

describe("without a session", () => {
  beforeAll(() => {
    mockState.email = null;
  });

  it("cannot read the company's time entries", async () => {
    const all = await api("GET", "/time-entries");
    expect(all.status).toBe(401);
    expect(all.body.message).toContain("sign in");
  });

  it("cannot read one employee's entries by naming them in the filter", async () => {
    const scoped = await api("GET", `/time-entries?employeeId=${ANA_ID}`);
    expect(scoped.status).toBe(401);
  });

  it("cannot file hours under anyone's name", async () => {
    const single = await api("POST", "/time-entries", entryBody(ANA_ID, "2028-04-05"));
    expect(single.status).toBe(401);

    const batch = await api("POST", "/time-entries/batch", {
      employeeId: ANA_ID,
      clientId: CLIENT_ID,
      date: "2028-04-05",
      visits: [{ visitType: "eval", quantity: 1 }],
    });
    expect(batch.status).toBe(401);
  });

  it("writes nothing when it is turned away", async () => {
    const rows = await db
      .select()
      .from(timeEntriesTable)
      .where(eq(timeEntriesTable.date, "2028-04-05"));
    expect(rows.filter((r) => EMPLOYEE_IDS.includes(r.employeeId))).toHaveLength(0);
  });

  it("cannot read the client list or the practice-data counts", async () => {
    expect((await api("GET", "/clients")).status).toBe(401);
    expect((await api("GET", "/demo-data")).status).toBe(401);
    expect((await api("GET", `/clients/${CLIENT_ID}/visit-entry-count`)).status).toBe(401);
    expect((await api("GET", `/clients/${CLIENT_ID}/hourly-entry-count`)).status).toBe(401);
  });
});

describe("a signed-in email that isn't a working profile", () => {
  it("tells a stranger they aren't linked, without listing anything", async () => {
    mockState.email = STRANGER_EMAIL;
    const res = await api("GET", "/time-entries");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NOT_LINKED");
  });

  it("tells someone waiting on Molly to check back", async () => {
    mockState.email = WAITING_EMAIL;
    const res = await api("GET", "/time-entries");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("LINK_REQUEST_PENDING");
  });

  it("refuses an employee whose sign-in Molly turned off", async () => {
    mockState.email = BLOCKED_EMAIL;
    const read = await api("GET", "/time-entries");
    expect(read.status).toBe(403);
    expect(read.body.code).toBe("SIGN_IN_DISABLED");

    const write = await api("POST", "/time-entries", entryBody(BLOCKED_ID, "2028-04-06"));
    expect(write.status).toBe(403);
    expect(write.body.code).toBe("SIGN_IN_DISABLED");
  });
});

describe("a signed-in employee", () => {
  it("sees their own entries and not a colleague's", async () => {
    mockState.email = ANA_EMAIL;
    const res = await api("GET", "/time-entries");
    expect(res.status).toBe(200);
    const ids = res.body.map((e: { id: string }) => e.id);
    expect(ids).toContain(anaEntryId);
    expect(ids).not.toContain(benEntryId);
  });

  it("still sees only their own when they ask for a colleague's", async () => {
    mockState.email = ANA_EMAIL;
    const res = await api("GET", `/time-entries?employeeId=${BEN_ID}`);
    expect(res.status).toBe(200);
    const ids = res.body.map((e: { id: string }) => e.id);
    expect(ids).not.toContain(benEntryId);
    expect(ids).toContain(anaEntryId);
  });

  it("files hours under themselves even when they name a colleague", async () => {
    mockState.email = ANA_EMAIL;
    const res = await api("POST", "/time-entries", entryBody(BEN_ID, "2028-04-07"));
    expect(res.status).toBe(201);
    expect(res.body.employeeId).toBe(ANA_ID);
    expect(res.body.employeeName).toBe("Ana Access");
  });

  it("cannot approve their own entry", async () => {
    mockState.email = ANA_EMAIL;
    const res = await api("POST", `/time-entries/${anaEntryId}/approve`);
    expect(res.status).toBe(403);
  });
});

describe("Molly", () => {
  it("sees the whole roster's entries", async () => {
    mockState.email = ADMIN_EMAIL;
    const res = await api("GET", "/time-entries");
    expect(res.status).toBe(200);
    const ids = res.body.map((e: { id: string }) => e.id);
    expect(ids).toContain(anaEntryId);
    expect(ids).toContain(benEntryId);
  });

  it("can file hours for the employee who forgot", async () => {
    mockState.email = ADMIN_EMAIL;
    const res = await api("POST", "/time-entries", entryBody(BEN_ID, "2028-04-08"));
    expect(res.status).toBe(201);
    expect(res.body.employeeId).toBe(BEN_ID);
    mockState.email = null;
  });
});
