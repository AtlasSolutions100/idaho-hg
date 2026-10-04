// GET /session — the app's "who am I" call.
//
// This endpoint exists because the web app could not tell "you are not the
// administrator" apart from "no administrator is configured", and showed the
// same broken, unexplained admin screens for both. Molly was locked out of
// her own admin side for weeks on that ambiguity. Every arm below is a screen
// the app now renders differently, so each one is pinned here.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "node:http";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  employeesTable,
  employeeLinkRequestsTable,
} from "@workspace/db";

const mockState: { email: string | null } = { email: null };

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: () => (mockState.email ? { userId: "user_session_e2e" } : null),
  clerkClient: {
    users: {
      getUser: async () => ({
        primaryEmailAddress: { emailAddress: mockState.email },
        emailAddresses: [{ emailAddress: mockState.email }],
      }),
      getUserList: async () => ({ data: [{ id: "user_session_e2e" }] }),
      createUser: async () => ({ id: "user_session_e2e" }),
    },
    sessions: {
      getSessionList: async () => ({ data: [] }),
      revokeSession: async () => ({}),
    },
  },
}));

const ADMIN_EMAIL = "admin-session-e2e@example.com";
process.env.ADMIN_EMAIL = ADMIN_EMAIL;

const { default: app } = await import("../app");

let server: Server;
let baseUrl: string;

const WORKER_ID = "e2e-session-worker";
const WORKER_EMAIL = "worker-session-e2e@example.com";
const BLOCKED_ID = "e2e-session-blocked";
const BLOCKED_EMAIL = "blocked-session-e2e@example.com";
const WAITING_EMAIL = "waiting-session-e2e@example.com";
const STRANGER_EMAIL = "stranger-session-e2e@example.com";
const EMPLOYEE_IDS = [WORKER_ID, BLOCKED_ID];

async function getSession() {
  const res = await fetch(`${baseUrl}/api/session`);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function cleanup() {
  await db.delete(employeesTable).where(inArray(employeesTable.id, EMPLOYEE_IDS));
  await db
    .delete(employeeLinkRequestsTable)
    .where(eq(employeeLinkRequestsTable.email, WAITING_EMAIL));
}

beforeAll(async () => {
  await cleanup();
  await db.insert(employeesTable).values([
    { id: WORKER_ID, name: "Session Worker", role: "RN", email: WORKER_EMAIL },
    {
      id: BLOCKED_ID,
      name: "Session Blocked",
      role: "RN",
      email: BLOCKED_EMAIL,
      signInEnabled: false,
    },
  ]);
  await db.insert(employeeLinkRequestsTable).values({
    id: "e2e-session-waiting",
    employeeId: WORKER_ID,
    email: WAITING_EMAIL,
  });

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address();
  if (address == null || typeof address === "string") throw new Error("No server port");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  process.env.ADMIN_EMAIL = ADMIN_EMAIL;
  mockState.email = null;
  await cleanup();
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await pool.end();
});

describe("GET /session", () => {
  it("refuses a caller with no session", async () => {
    mockState.email = null;
    const res = await getSession();
    expect(res.status).toBe(401);
  });

  it("tells Molly she is the administrator", async () => {
    mockState.email = ADMIN_EMAIL;
    const res = await getSession();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      email: ADMIN_EMAIL,
      isAdmin: true,
      adminConfigured: true,
      access: "admin",
    });
  });

  it("identifies a linked employee and hands back their profile", async () => {
    mockState.email = WORKER_EMAIL;
    const res = await getSession();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      email: WORKER_EMAIL,
      isAdmin: false,
      adminConfigured: true,
      access: "employee",
    });
    expect(res.body.employee).toMatchObject({ id: WORKER_ID, name: "Session Worker" });
  });

  it("separates waiting, turned off, and not on the roster", async () => {
    mockState.email = WAITING_EMAIL;
    expect((await getSession()).body.access).toBe("pending");

    mockState.email = BLOCKED_EMAIL;
    expect((await getSession()).body.access).toBe("disabled");

    mockState.email = STRANGER_EMAIL;
    const stranger = await getSession();
    expect(stranger.body.access).toBe("not-linked");
    expect(stranger.body.isAdmin).toBe(false);
  });

  it("says when the server has no administrator at all", async () => {
    // The distinction that cost Molly weeks: with nothing configured nobody
    // is the admin, and the app must say that instead of telling the owner
    // she is not the administrator.
    delete process.env.ADMIN_EMAIL;
    try {
      mockState.email = ADMIN_EMAIL;
      const res = await getSession();
      expect(res.status).toBe(200);
      expect(res.body.adminConfigured).toBe(false);
      expect(res.body.isAdmin).toBe(false);
    } finally {
      process.env.ADMIN_EMAIL = ADMIN_EMAIL;
    }
  });

  it("accepts several administrators, so the owner and the developer both get in", async () => {
    // ADMIN_EMAIL is a list. One value is still one administrator, but a
    // second means adding the developer no longer takes Molly's access away.
    const SECOND = "second-admin-session-e2e@example.com";
    process.env.ADMIN_EMAIL = `${ADMIN_EMAIL} ,  ${SECOND}`;
    try {
      mockState.email = SECOND;
      expect((await getSession()).body.isAdmin).toBe(true);
      mockState.email = ADMIN_EMAIL;
      expect((await getSession()).body.isAdmin).toBe(true);
      mockState.email = STRANGER_EMAIL;
      expect((await getSession()).body.isAdmin).toBe(false);
    } finally {
      process.env.ADMIN_EMAIL = ADMIN_EMAIL;
    }
  });

  it("never returns the configured administrator address to anyone else", async () => {
    mockState.email = WORKER_EMAIL;
    const res = await getSession();
    expect(JSON.stringify(res.body)).not.toContain(ADMIN_EMAIL);
  });
});
