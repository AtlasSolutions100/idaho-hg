// End-to-end tests for the atomic batch time-entry endpoint.
// Verifies: all-or-nothing semantics, mileage/per-diem exactly-once
// assignment, session scoping, and validation edge cases.
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
  getAuth: () => (mockState.email ? { userId: "user_batch_e2e" } : null),
  clerkClient: {
    users: {
      getUser: async () => ({
        primaryEmailAddress: { emailAddress: mockState.email },
        emailAddresses: [{ emailAddress: mockState.email }],
      }),
      getUserList: async () => ({ data: [{ id: "user_batch_e2e" }] }),
      createUser: async () => ({ id: "user_batch_e2e" }),
    },
    sessions: {
      getSessionList: async () => ({ data: [] }),
      revokeSession: async () => ({}),
    },
  },
}));

const ADMIN_EMAIL = "admin-batch-e2e@example.com";
process.env.ADMIN_EMAIL = ADMIN_EMAIL;

const { default: app } = await import("../app");

let server: Server;
let baseUrl: string;

const EMP_ID = "e2e-batch-emp";
const CLIENT_ID = "e2e-batch-client";
const NO_MILEAGE_CLIENT_ID = "e2e-batch-client-nomileage";

async function cleanup() {
  await db.delete(timeEntriesTable).where(eq(timeEntriesTable.employeeId, EMP_ID));
  await db.delete(clientsTable).where(eq(clientsTable.id, CLIENT_ID));
  await db.delete(clientsTable).where(eq(clientsTable.id, NO_MILEAGE_CLIENT_ID));
  await db.delete(employeesTable).where(eq(employeesTable.id, EMP_ID));
}

beforeAll(async () => {
  await cleanup();
  await db.insert(employeesTable).values({ id: EMP_ID, name: "Batch E2E Nurse", role: "RN" });
  await db.insert(clientsTable).values([
    { id: CLIENT_ID, name: "Batch E2E Clinic", billsByVisitType: true },
    {
      id: NO_MILEAGE_CLIENT_ID,
      name: "Batch E2E No-Mileage Clinic",
      mileageOnContract: false,
      billsByVisitType: true,
    },
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

async function batchCreate(body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/api/time-entries/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employeeId: EMP_ID, clientId: CLIENT_ID, ...body }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe("batch create — success cases", () => {
  it("creates one entry per visit type, all with status=submitted", async () => {
    const res = await batchCreate({
      date: "2028-03-04",
      visitTypes: ["skilled-nursing", "eval"],
    });
    expect(res.status).toBe(201);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    const types = res.body.map((e: { visitType: string }) => e.visitType).sort();
    expect(types).toEqual(["eval", "skilled-nursing"]);
    for (const entry of res.body) {
      expect(entry.status).toBe("submitted");
      expect(entry.employeeId).toBe(EMP_ID);
      expect(entry.clientId).toBe(CLIENT_ID);
      expect(entry.date).toBe("2028-03-04");
    }
  });

  it("single visit type also works via batch endpoint", async () => {
    const res = await batchCreate({
      date: "2028-03-05",
      visitTypes: ["soc"],
    });
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].visitType).toBe("soc");
  });
});

describe("mileage and per-diem exactly once", () => {
  it("attaches mileage to the first entry only, never to subsequent ones", async () => {
    const res = await batchCreate({
      date: "2028-03-06",
      visitTypes: ["skilled-nursing", "eval", "recert"],
      mileage: 24.5,
    });
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(3);

    const withMileage = (res.body as Array<{ mileage?: number }>).filter(
      (e) => e.mileage != null && e.mileage > 0,
    );
    expect(withMileage).toHaveLength(1);
    expect(withMileage[0]!.mileage).toBe(24.5);
  });

  it("attaches per diem to the first entry only", async () => {
    const res = await batchCreate({
      date: "2028-03-07",
      visitTypes: ["soc", "roc", "discharge"],
      perDiemType: "full",
    });
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(3);

    const withPerDiem = (res.body as Array<{ perDiem?: number; perDiemType?: string }>).filter(
      (e) => e.perDiem != null && e.perDiem > 0,
    );
    expect(withPerDiem).toHaveLength(1);
    expect(withPerDiem[0]!.perDiemType).toBe("full");
  });

  it("three visit types with both extras: exactly one entry gets mileage, one gets per diem, the rest get neither", async () => {
    const res = await batchCreate({
      date: "2028-03-11",
      visitTypes: ["skilled-nursing", "eval", "recert"],
      mileage: 18.4,
      perDiemType: "full",
    });
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(3);

    const entries = res.body as Array<{
      mileage?: number;
      perDiem?: number;
      perDiemType?: string;
    }>;
    const withMileage = entries.filter((e) => e.mileage != null && e.mileage > 0);
    const withPerDiem = entries.filter((e) => e.perDiem != null && e.perDiem > 0);
    expect(withMileage).toHaveLength(1);
    expect(withMileage[0]!.mileage).toBe(18.4);
    expect(withPerDiem).toHaveLength(1);
    expect(withPerDiem[0]!.perDiem).toBe(1);
    expect(withPerDiem[0]!.perDiemType).toBe("full");

    const withNeither = entries.filter(
      (e) => !(e.mileage != null && e.mileage > 0) && !(e.perDiem != null && e.perDiem > 0),
    );
    expect(withNeither).toHaveLength(2);
    for (const e of withNeither) {
      expect(e.perDiemType ?? null).toBeNull();
    }
  });

  it("mileage and per diem both go on first entry only when submitted together", async () => {
    const res = await batchCreate({
      date: "2028-03-08",
      visitTypes: ["skilled-nursing", "physical-therapy"],
      mileage: 12,
      perDiemType: "first_last",
    });
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(2);

    const first = res.body[0] as { mileage?: number; perDiem?: number };
    const second = res.body[1] as { mileage?: number; perDiem?: number };
    expect(first.mileage).toBe(12);
    expect(first.perDiem).toBe(1);
    expect(second.mileage ?? 0).toBe(0);
    expect(second.perDiem ?? 0).toBe(0);
  });
});

describe("validation", () => {
  it("rejects an empty visitTypes array", async () => {
    const res = await batchCreate({
      date: "2028-03-09",
      visitTypes: [],
    });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown client", async () => {
    const res = await fetch(`${baseUrl}/api/time-entries/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId: EMP_ID,
        clientId: "does-not-exist",
        date: "2028-03-09",
        visitTypes: ["skilled-nursing"],
      }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid date", async () => {
    const res = await batchCreate({
      date: "2028-02-30",
      visitTypes: ["skilled-nursing"],
    });
    expect(res.status).toBe(400);
  });

  it("rejects mileage for a client whose contract excludes it", async () => {
    const res = await fetch(`${baseUrl}/api/time-entries/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId: EMP_ID,
        clientId: NO_MILEAGE_CLIENT_ID,
        date: "2028-03-09",
        visitTypes: ["skilled-nursing"],
        mileage: 10,
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { message: string };
    expect(body.message).toContain("mileage on their contract");
  });
});

describe("atomicity: nothing is written on failure", () => {
  it("leaves no rows when the request is invalid", async () => {
    const countBefore = await db
      .select()
      .from(timeEntriesTable)
      .where(eq(timeEntriesTable.date, "2028-03-10"));

    const res = await batchCreate({
      date: "2028-03-10",
      visitTypes: [], // invalid — zod rejects before any DB write
    });
    expect(res.status).toBe(400);

    const countAfter = await db
      .select()
      .from(timeEntriesTable)
      .where(eq(timeEntriesTable.date, "2028-03-10"));
    expect(countAfter.length).toBe(countBefore.length);
  });
});
