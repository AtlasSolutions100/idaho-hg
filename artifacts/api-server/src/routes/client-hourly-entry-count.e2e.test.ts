// End-to-end tests for GET /clients/:id/hourly-entry-count — the count that
// backs the "are you sure?" warning when Molly turns ON visit billing for a
// client whose employees have been logging plain time in/out recently.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import {
  db,
  pool,
  clientsTable,
  employeesTable,
  timeEntriesTable,
} from "@workspace/db";

const mockState: { email: string | null } = { email: null };

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: () => (mockState.email ? { userId: "user_hourlycount_e2e" } : null),
  clerkClient: {
    users: {
      getUser: async () => ({
        primaryEmailAddress: { emailAddress: mockState.email },
        emailAddresses: [{ emailAddress: mockState.email }],
      }),
      getUserList: async () => ({ data: [{ id: "user_hourlycount_e2e" }] }),
      createUser: async () => ({ id: "user_hourlycount_e2e" }),
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

const EMP_ID = "e2e-hourlycount-employee";
const CLIENT_ID = "e2e-hourlycount-client";
const EMPTY_CLIENT_ID = "e2e-hourlycount-client-empty";

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

async function cleanup() {
  await db.delete(timeEntriesTable).where(eq(timeEntriesTable.employeeId, EMP_ID));
  await db.delete(clientsTable).where(eq(clientsTable.id, CLIENT_ID));
  await db.delete(clientsTable).where(eq(clientsTable.id, EMPTY_CLIENT_ID));
  await db.delete(employeesTable).where(eq(employeesTable.id, EMP_ID));
}

beforeAll(async () => {
  await cleanup();
  await db.insert(employeesTable).values({ id: EMP_ID, name: "HourlyCount E2E Nurse", role: "RN" });
  await db.insert(clientsTable).values([
    { id: CLIENT_ID, name: "HourlyCount E2E Clinic", billsByVisitType: false },
    { id: EMPTY_CLIENT_ID, name: "HourlyCount E2E Empty Clinic", billsByVisitType: false },
  ]);

  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 5);
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 10);
  const fourMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 4, 15);
  const base = {
    employeeId: EMP_ID,
    employeeName: "HourlyCount E2E Nurse",
    employeeRole: "RN",
    clientId: CLIENT_ID,
    clientName: "HourlyCount E2E Clinic",
    status: "pending" as const,
  };
  await db.insert(timeEntriesTable).values([
    // Two plain hourly entries in recent months → counted.
    { ...base, date: isoDate(thisMonth), hours: 4 },
    { ...base, date: isoDate(lastMonth), hours: 6 },
    // Visit-type entry in a recent month → NOT counted.
    { ...base, date: isoDate(thisMonth), visitType: "soc" },
    // Hourly entry outside the recent window → NOT counted.
    { ...base, date: isoDate(fourMonthsAgo), hours: 8 },
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

describe("GET /clients/:id/hourly-entry-count", () => {
  it("counts only no-visit-type entries in the current and previous two months", async () => {
    const res = await fetch(`${baseUrl}/api/clients/${CLIENT_ID}/hourly-entry-count`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 2 });
  });

  it("returns zero for a client with no hourly entries", async () => {
    const res = await fetch(`${baseUrl}/api/clients/${EMPTY_CLIENT_ID}/hourly-entry-count`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 0 });
  });

  it("returns zero for an unknown client rather than failing", async () => {
    const res = await fetch(`${baseUrl}/api/clients/no-such-client/hourly-entry-count`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 0 });
  });
});
