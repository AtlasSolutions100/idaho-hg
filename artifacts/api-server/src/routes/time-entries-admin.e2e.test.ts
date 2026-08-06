// Verifies Molly's admin sign-in can see every time entry on the payroll
// page: her email isn't a roster profile, so without the admin check she'd
// be rejected as "not linked" and the approval list would show nothing.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import { db, pool, employeesTable, timeEntriesTable } from "@workspace/db";

const mockState: { email: string | null } = { email: null };

vi.mock("@clerk/express", () => ({
  getAuth: () => (mockState.email ? { userId: "user_te_admin_e2e" } : null),
  clerkClient: {
    users: {
      getUser: async () => ({
        primaryEmailAddress: { emailAddress: mockState.email },
        emailAddresses: [{ emailAddress: mockState.email }],
      }),
      getUserList: async () => ({ data: [] }),
      createUser: async () => ({}),
    },
    sessions: { getSessionList: async () => ({ data: [] }), revokeSession: async () => ({}) },
  },
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const ADMIN_EMAIL = "admin-te-e2e@example.com";
process.env.ADMIN_EMAIL = ADMIN_EMAIL;

const { default: app } = await import("../app");

let server: Server;
let baseUrl: string;

const EMP_ID = "te-admin-e2e-emp";

beforeAll(async () => {
  await db.delete(timeEntriesTable).where(eq(timeEntriesTable.employeeId, EMP_ID));
  await db.delete(employeesTable).where(eq(employeesTable.id, EMP_ID));
  await db.insert(employeesTable).values({ id: EMP_ID, name: "TE Admin E2E", role: "RN" });
  await db.insert(timeEntriesTable).values({
    employeeId: EMP_ID,
    employeeName: "TE Admin E2E",
    employeeRole: "RN",
    clientId: "te-admin-e2e-client",
    clientName: "TE Admin Clinic",
    date: "2023-12-05",
    hours: 3,
    status: "submitted",
  });
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address();
  if (address == null || typeof address === "string") throw new Error("No server port");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await db.delete(timeEntriesTable).where(eq(timeEntriesTable.employeeId, EMP_ID));
  await db.delete(employeesTable).where(eq(employeesTable.id, EMP_ID));
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await pool.end();
});

describe("GET /time-entries as admin", () => {
  it("Molly's admin session sees all entries, not a 'not linked' rejection", async () => {
    mockState.email = ADMIN_EMAIL;
    const res = await fetch(`${baseUrl}/api/time-entries`);
    expect(res.status).toBe(200);
    const entries = (await res.json()) as Array<{ employeeId: string }>;
    expect(entries.some((e) => e.employeeId === EMP_ID)).toBe(true);
    mockState.email = null;
  });

  it("a signed-in email that isn't linked is still rejected", async () => {
    mockState.email = "random-stranger-te-e2e@example.com";
    const res = await fetch(`${baseUrl}/api/time-entries`);
    expect(res.status).toBe(403);
    mockState.email = null;
  });
});
