// End-to-end tests for the overhauled time-entry rules: hours computed from
// clock times, mileage blocked for clients without it on contract, the
// two-option per diem, and server-derived weekend/holiday flags (anything the
// client sends for those is ignored).
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

// Clerk mock: mockState.email = ADMIN_EMAIL makes requests count as Molly.
const mockState: { email: string | null } = { email: null };

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: () => (mockState.email ? { userId: "user_rules_e2e" } : null),
  clerkClient: {
    users: {
      getUser: async () => ({
        primaryEmailAddress: { emailAddress: mockState.email },
        emailAddresses: [{ emailAddress: mockState.email }],
      }),
      getUserList: async () => ({ data: [{ id: "user_rules_e2e" }] }),
      createUser: async () => ({ id: "user_rules_e2e" }),
    },
    sessions: {
      getSessionList: async () => ({ data: [] }),
      revokeSession: async () => ({}),
    },
  },
}));

const ADMIN_EMAIL = "admin-rules-e2e@example.com";
process.env.ADMIN_EMAIL = ADMIN_EMAIL;

const { default: app } = await import("../app");

let server: Server;
let baseUrl: string;

const EMP_ID = "e2e-rules-employee";
const CLIENT_ID = "e2e-rules-client"; // mileage on contract
const NO_MILEAGE_CLIENT_ID = "e2e-rules-client-nomileage";

async function cleanup() {
  await db.delete(timeEntriesTable).where(eq(timeEntriesTable.employeeId, EMP_ID));
  await db.delete(clientsTable).where(eq(clientsTable.id, CLIENT_ID));
  await db.delete(clientsTable).where(eq(clientsTable.id, NO_MILEAGE_CLIENT_ID));
  await db.delete(employeesTable).where(eq(employeesTable.id, EMP_ID));
}

beforeAll(async () => {
  await cleanup();
  await db.insert(employeesTable).values({ id: EMP_ID, name: "Rules E2E Nurse", role: "RN" });
  await db.insert(clientsTable).values([
    { id: CLIENT_ID, name: "Rules E2E Clinic" },
    { id: NO_MILEAGE_CLIENT_ID, name: "Rules E2E No-Mileage Clinic", mileageOnContract: false },
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

async function createEntry(body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/api/time-entries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employeeId: EMP_ID, clientId: CLIENT_ID, ...body }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe("clock times", () => {
  it("computes hours from time in/out, including odd minutes", async () => {
    const res = await createEntry({ date: "2027-07-06", timeIn: "08:22", timeOut: "16:30" });
    expect(res.status).toBe(201);
    expect(res.body.hours).toBe(8.13);
    expect(res.body.timeIn).toBe("08:22");
    expect(res.body.timeOut).toBe("16:30");
  });

  it("handles overnight shifts", async () => {
    const res = await createEntry({ date: "2027-07-06", timeIn: "22:00", timeOut: "06:00" });
    expect(res.status).toBe(201);
    expect(res.body.hours).toBe(8);
  });

  it("requires both times when one is given", async () => {
    const res = await createEntry({ date: "2027-07-06", timeIn: "08:00" });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("both a time in and a time out");
  });

  it("still accepts legacy plain hours (older app versions)", async () => {
    const res = await createEntry({ date: "2027-07-06", hours: 5 });
    expect(res.status).toBe(201);
    expect(res.body.hours).toBe(5);
    expect(res.body.timeIn).toBeUndefined();
  });
});

describe("mileage on contract", () => {
  it("rejects mileage for a client without mileage on contract", async () => {
    const res = await createEntry({
      clientId: NO_MILEAGE_CLIENT_ID,
      date: "2027-07-06",
      timeIn: "08:00",
      timeOut: "12:00",
      mileage: 30,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("doesn't include mileage on their contract");
  });

  it("accepts mileage when the contract includes it", async () => {
    const res = await createEntry({
      date: "2027-07-06",
      timeIn: "08:00",
      timeOut: "12:00",
      mileage: 30,
    });
    expect(res.status).toBe(201);
    expect(res.body.mileage).toBe(30);
  });
});

describe("per diem", () => {
  it("records the chosen option and counts it as one per-diem day", async () => {
    for (const perDiemType of ["first_last", "full"] as const) {
      const res = await createEntry({
        date: "2027-07-06",
        timeIn: "08:00",
        timeOut: "12:00",
        perDiemType,
      });
      expect(res.status).toBe(201);
      expect(res.body.perDiemType).toBe(perDiemType);
      expect(res.body.perDiem).toBe(1);
    }
  });

  it("rejects values outside the two options", async () => {
    const res = await createEntry({
      date: "2027-07-06",
      timeIn: "08:00",
      timeOut: "12:00",
      perDiemType: "half",
    });
    expect(res.status).toBe(400);
  });
});

describe("weekend/holiday are the server's call", () => {
  it("derives weekend from the date even when the client says otherwise", async () => {
    const res = await createEntry({
      date: "2027-07-10", // Saturday
      timeIn: "08:00",
      timeOut: "12:00",
      isWeekend: false,
      isHoliday: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.isWeekend).toBe(true);
    expect(res.body.isHoliday).toBe(false);
  });

  it("flags holidays from the shared calendar", async () => {
    const res = await createEntry({
      date: "2027-12-25", // Christmas (Saturday too)
      timeIn: "08:00",
      timeOut: "12:00",
    });
    expect(res.status).toBe(201);
    expect(res.body.isHoliday).toBe(true);
    expect(res.body.isWeekend).toBe(true);
  });

  it("weekdays stay unflagged", async () => {
    const res = await createEntry({
      date: "2027-07-06", // Tuesday
      timeIn: "08:00",
      timeOut: "12:00",
      isWeekend: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.isWeekend).toBe(false);
    expect(res.body.isHoliday).toBe(false);
  });
});

describe("invalid dates", () => {
  it("rejects impossible calendar dates instead of normalizing them", async () => {
    const res = await createEntry({ date: "2027-02-30", timeIn: "08:00", timeOut: "12:00" });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("date doesn't exist");
  });
});

describe("client mileage setting", () => {
  it("cannot be changed without an admin session", async () => {
    mockState.email = null;
    const patch = await fetch(`${baseUrl}/api/clients/${CLIENT_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mileageOnContract: false }),
    });
    expect(patch.status).toBe(401);

    mockState.email = "not-molly@example.com";
    const patch2 = await fetch(`${baseUrl}/api/clients/${CLIENT_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mileageOnContract: false }),
    });
    expect(patch2.status).toBe(403);
    mockState.email = null;
  });

  it("can be toggled by the admin and is reported in the client list", async () => {
    mockState.email = ADMIN_EMAIL;
    const patch = await fetch(`${baseUrl}/api/clients/${CLIENT_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mileageOnContract: false }),
    });
    expect(patch.status).toBe(200);
    const patched = (await patch.json()) as { mileageOnContract: boolean };
    expect(patched.mileageOnContract).toBe(false);

    // Entry submission happens without the admin session (an admin session
    // is not a roster employee and would be rejected outright).
    mockState.email = null;
    const rejected = await createEntry({
      date: "2027-07-07",
      timeIn: "08:00",
      timeOut: "12:00",
      mileage: 10,
    });
    expect(rejected.status).toBe(400);

    // Restore for the other tests (file runs sequentially).
    mockState.email = ADMIN_EMAIL;
    const restore = await fetch(`${baseUrl}/api/clients/${CLIENT_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mileageOnContract: true }),
    });
    expect(restore.status).toBe(200);
    mockState.email = null;
  });
});

describe("visit types only for visit-billing clients", () => {
  it("rejects a visit entry for a client that doesn't bill by visit type", async () => {
    const res = await createEntry({ date: "2027-07-08", visitType: "skilled-nursing" });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("doesn't bill by visit type");
  });

  it("rejects a batch of visits for a client that doesn't bill by visit type", async () => {
    const res = await fetch(`${baseUrl}/api/time-entries/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId: EMP_ID,
        clientId: CLIENT_ID,
        date: "2027-07-08",
        visitTypes: ["skilled-nursing", "eval"],
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("doesn't bill by visit type");
  });

  it("admin can turn visit billing on, after which visits are accepted (and off again)", async () => {
    // Only the admin can flip the setting.
    mockState.email = null;
    const anonPatch = await fetch(`${baseUrl}/api/clients/${CLIENT_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ billsByVisitType: true }),
    });
    expect([401, 403]).toContain(anonPatch.status);

    mockState.email = ADMIN_EMAIL;
    const patch = await fetch(`${baseUrl}/api/clients/${CLIENT_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ billsByVisitType: true }),
    });
    expect(patch.status).toBe(200);
    const patched = (await patch.json()) as { billsByVisitType: boolean };
    expect(patched.billsByVisitType).toBe(true);

    // Entry submission happens without the admin session.
    mockState.email = null;
    const accepted = await createEntry({ date: "2027-07-09", visitType: "skilled-nursing" });
    expect(accepted.status).toBe(201);
    expect(accepted.body.visitType).toBe("skilled-nursing");

    // Restore for other tests.
    mockState.email = ADMIN_EMAIL;
    const restore = await fetch(`${baseUrl}/api/clients/${CLIENT_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ billsByVisitType: false }),
    });
    expect(restore.status).toBe(200);
    expect(((await restore.json()) as { billsByVisitType: boolean }).billsByVisitType).toBe(false);
    mockState.email = null;
  });

  it("hourly time-in/out entries still work for a simple client", async () => {
    const res = await createEntry({ date: "2027-07-10", timeIn: "09:00", timeOut: "13:00" });
    expect(res.status).toBe(201);
    expect(res.body.hours).toBe(4);
  });
});
