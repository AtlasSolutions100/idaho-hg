// End-to-end tests for drafts and editing: draft privacy (admin and other
// employees never see them), edits re-run validation, approval locks entries,
// draft→submit stamps submittedAt, and approve/approve-all ignore drafts.
// Uses August 2027 dates — other e2e files own 2027-05/06/07 and 2023-10/11.
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

// Clerk mock: mockState.email = ADMIN_EMAIL makes requests count as Molly;
// an employee email makes them count as that signed-in employee; null = no session.
const mockState: { email: string | null } = { email: null };

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: () => (mockState.email ? { userId: "user_draft_e2e" } : null),
  clerkClient: {
    users: {
      getUser: async () => ({
        primaryEmailAddress: { emailAddress: mockState.email },
        emailAddresses: [{ emailAddress: mockState.email }],
      }),
      getUserList: async () => ({ data: [{ id: "user_draft_e2e" }] }),
      createUser: async () => ({ id: "user_draft_e2e" }),
    },
    sessions: {
      getSessionList: async () => ({ data: [] }),
      revokeSession: async () => ({}),
    },
  },
}));

const ADMIN_EMAIL = "admin-draft-e2e@example.com";
process.env.ADMIN_EMAIL = ADMIN_EMAIL;

const { default: app } = await import("../app");

let server: Server;
let baseUrl: string;

const EMP_ID = "e2e-draft-employee";
const EMP_EMAIL = "draft-owner-e2e@example.com";
const OTHER_EMP_ID = "e2e-draft-other-employee";
const OTHER_EMP_EMAIL = "draft-other-e2e@example.com";
const CLIENT_ID = "e2e-draft-client"; // mileage on contract, hourly billing
const NO_MILEAGE_CLIENT_ID = "e2e-draft-client-nomileage";

async function cleanup() {
  await db.delete(timeEntriesTable).where(eq(timeEntriesTable.employeeId, EMP_ID));
  await db.delete(timeEntriesTable).where(eq(timeEntriesTable.employeeId, OTHER_EMP_ID));
  await db.delete(clientsTable).where(eq(clientsTable.id, CLIENT_ID));
  await db.delete(clientsTable).where(eq(clientsTable.id, NO_MILEAGE_CLIENT_ID));
  await db.delete(employeesTable).where(eq(employeesTable.id, EMP_ID));
  await db.delete(employeesTable).where(eq(employeesTable.id, OTHER_EMP_ID));
}

beforeAll(async () => {
  await cleanup();
  await db.insert(employeesTable).values([
    { id: EMP_ID, name: "Draft E2E Nurse", role: "RN", email: EMP_EMAIL },
    { id: OTHER_EMP_ID, name: "Draft E2E Other Nurse", role: "RN", email: OTHER_EMP_EMAIL },
  ]);
  await db.insert(clientsTable).values([
    { id: CLIENT_ID, name: "Draft E2E Clinic" },
    { id: NO_MILEAGE_CLIENT_ID, name: "Draft E2E No-Mileage Clinic", mileageOnContract: false },
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
  body?: Record<string, unknown>,
) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function newEntry(extra: Record<string, unknown> = {}) {
  return api("POST", "/time-entries", {
    employeeId: EMP_ID,
    clientId: CLIENT_ID,
    date: "2027-08-03",
    timeIn: "08:00",
    timeOut: "12:00",
    ...extra,
  });
}

describe("saving drafts", () => {
  it("a signed-in employee creates an entry with status draft", async () => {
    mockState.email = EMP_EMAIL;
    const res = await newEntry({ status: "draft" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("draft");
    mockState.email = null;
  });

  it("defaults to submitted when no status is given", async () => {
    mockState.email = null;
    const res = await newEntry();
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("submitted");
  });

  it("anonymous requests can't save drafts (single or batch)", async () => {
    mockState.email = null;
    const single = await newEntry({ status: "draft" });
    expect(single.status).toBe(401);
    const batch = await api("POST", "/time-entries/batch", {
      employeeId: EMP_ID,
      clientId: CLIENT_ID,
      date: "2027-08-03",
      visitTypes: ["skilled-nursing"],
      status: "draft",
    });
    expect(batch.status).toBe(401);
  });
});

describe("draft privacy", () => {
  it("only the signed-in owner ever receives drafts", async () => {
    mockState.email = EMP_EMAIL;
    const created = await newEntry({ status: "draft", date: "2027-08-04" });
    expect(created.status).toBe(201);
    const draftId = created.body.id as string;

    mockState.email = ADMIN_EMAIL;
    const adminList = await api("GET", "/time-entries");
    expect(adminList.status).toBe(200);
    expect(adminList.body.some((e: { id: string }) => e.id === draftId)).toBe(false);

    mockState.email = EMP_EMAIL;
    const ownList = await api("GET", "/time-entries");
    expect(ownList.status).toBe(200);
    expect(ownList.body.some((e: { id: string }) => e.id === draftId)).toBe(true);

    // Anonymous lists must not leak drafts — not even when the caller
    // supplies the owner's employeeId as a filter.
    mockState.email = null;
    const anonList = await api("GET", "/time-entries");
    expect(anonList.body.some((e: { id: string }) => e.id === draftId)).toBe(false);
    const anonScoped = await api("GET", `/time-entries?employeeId=${EMP_ID}`);
    expect(anonScoped.status).toBe(200);
    expect(anonScoped.body.some((e: { id: string }) => e.id === draftId)).toBe(false);
  });

  it("anonymous callers can't edit anything, draft or not", async () => {
    mockState.email = EMP_EMAIL;
    const created = await newEntry({ status: "draft", date: "2027-08-23" });
    const draftId = created.body.id as string;

    mockState.email = null;
    const anonEdit = await api("PATCH", `/time-entries/${draftId}`, {
      clientId: CLIENT_ID,
      date: "2027-08-23",
      timeIn: "09:00",
      timeOut: "10:00",
    });
    expect(anonEdit.status).toBe(401);
  });

  it("another signed-in employee can't see or edit someone's draft", async () => {
    mockState.email = EMP_EMAIL;
    const created = await newEntry({ status: "draft", date: "2027-08-05" });
    const draftId = created.body.id as string;

    mockState.email = OTHER_EMP_EMAIL;
    const otherList = await api("GET", "/time-entries");
    expect(otherList.body.some((e: { id: string }) => e.id === draftId)).toBe(false);

    const otherEdit = await api("PATCH", `/time-entries/${draftId}`, {
      clientId: CLIENT_ID,
      date: "2027-08-05",
      timeIn: "09:00",
      timeOut: "10:00",
    });
    // Not found, not forbidden — existence must not leak.
    expect(otherEdit.status).toBe(404);
    mockState.email = null;
  });

  it("drafts can't be approved or rejected, and approve-all skips them", async () => {
    mockState.email = EMP_EMAIL;
    const created = await newEntry({ status: "draft", date: "2027-08-06" });
    const draftId = created.body.id as string;

    mockState.email = null;
    const approve = await api("POST", `/time-entries/${draftId}/approve`);
    expect(approve.status).toBe(404);
    const reject = await api("POST", `/time-entries/${draftId}/reject`);
    expect(reject.status).toBe(404);

    await api("POST", "/time-entries/approve-all");
    const [row] = await db
      .select()
      .from(timeEntriesTable)
      .where(eq(timeEntriesTable.id, Number(draftId)));
    expect(row?.status).toBe("draft");
  });
});

describe("editing entries", () => {
  it("the owner edits a submitted entry and it stays submitted", async () => {
    mockState.email = EMP_EMAIL;
    const created = await newEntry({ date: "2027-08-09" });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const edited = await api("PATCH", `/time-entries/${id}`, {
      clientId: CLIENT_ID,
      date: "2027-08-10",
      timeIn: "07:30",
      timeOut: "15:30",
      note: "corrected times",
    });
    expect(edited.status).toBe(200);
    expect(edited.body.status).toBe("submitted");
    expect(edited.body.date).toBe("2027-08-10");
    expect(edited.body.hours).toBe(8);
    expect(edited.body.note).toBe("corrected times");
    mockState.email = null;
  });

  it("edits re-run create-time rules (mileage on contract)", async () => {
    mockState.email = EMP_EMAIL;
    const created = await newEntry({ date: "2027-08-11" });
    const id = created.body.id as string;

    const edited = await api("PATCH", `/time-entries/${id}`, {
      clientId: NO_MILEAGE_CLIENT_ID,
      date: "2027-08-11",
      timeIn: "08:00",
      timeOut: "12:00",
      mileage: 25,
    });
    expect(edited.status).toBe(400);
    expect(edited.body.message).toContain("doesn't include mileage on their contract");
    mockState.email = null;
  });

  it("edits re-run visit-type gating for hourly-only clients", async () => {
    mockState.email = EMP_EMAIL;
    const created = await newEntry({ date: "2027-08-12" });
    const id = created.body.id as string;

    const edited = await api("PATCH", `/time-entries/${id}`, {
      clientId: CLIENT_ID,
      date: "2027-08-12",
      visitType: "skilled-nursing",
    });
    expect(edited.status).toBe(400);
    expect(edited.body.message).toContain("doesn't bill by visit type");
    mockState.email = null;
  });

  it("submitting a draft stamps a fresh submittedAt", async () => {
    mockState.email = EMP_EMAIL;
    const created = await newEntry({ status: "draft", date: "2027-08-13" });
    const id = created.body.id as string;
    const draftSubmittedAt = created.body.submittedAt as string;

    await new Promise((r) => setTimeout(r, 20));
    const submitted = await api("PATCH", `/time-entries/${id}`, {
      clientId: CLIENT_ID,
      date: "2027-08-13",
      timeIn: "08:00",
      timeOut: "12:00",
      status: "submitted",
    });
    expect(submitted.status).toBe(200);
    expect(submitted.body.status).toBe("submitted");
    expect(new Date(submitted.body.submittedAt).getTime()).toBeGreaterThan(
      new Date(draftSubmittedAt).getTime(),
    );
    mockState.email = null;
  });

  it("a draft edited with status draft stays a draft", async () => {
    mockState.email = EMP_EMAIL;
    const created = await newEntry({ status: "draft", date: "2027-08-16" });
    const id = created.body.id as string;

    const edited = await api("PATCH", `/time-entries/${id}`, {
      clientId: CLIENT_ID,
      date: "2027-08-16",
      timeIn: "10:00",
      timeOut: "14:00",
      status: "draft",
    });
    expect(edited.status).toBe(200);
    expect(edited.body.status).toBe("draft");
    mockState.email = null;
  });

  it("a submitted entry can't be turned back into a draft", async () => {
    mockState.email = EMP_EMAIL;
    const created = await newEntry({ date: "2027-08-17" });
    const id = created.body.id as string;

    const edited = await api("PATCH", `/time-entries/${id}`, {
      clientId: CLIENT_ID,
      date: "2027-08-17",
      timeIn: "08:00",
      timeOut: "12:00",
      status: "draft",
    });
    expect(edited.status).toBe(400);
    expect(edited.body.message).toContain("can't be turned back into a draft");
    mockState.email = null;
  });

  it("a rejected entry can be edited and comes back as submitted", async () => {
    mockState.email = null;
    const created = await newEntry({ date: "2027-08-18" });
    const id = created.body.id as string;
    await api("POST", `/time-entries/${id}/reject`);

    mockState.email = EMP_EMAIL;
    const edited = await api("PATCH", `/time-entries/${id}`, {
      clientId: CLIENT_ID,
      date: "2027-08-18",
      timeIn: "08:00",
      timeOut: "16:00",
    });
    expect(edited.status).toBe(200);
    expect(edited.body.status).toBe("submitted");
    mockState.email = null;
  });
});

describe("approval locks the entry", () => {
  it("refuses edits once approved, even by the owner", async () => {
    mockState.email = null;
    const created = await newEntry({ date: "2027-08-19" });
    const id = created.body.id as string;
    const approved = await api("POST", `/time-entries/${id}/approve`);
    expect(approved.status).toBe(200);

    mockState.email = EMP_EMAIL;
    const edited = await api("PATCH", `/time-entries/${id}`, {
      clientId: CLIENT_ID,
      date: "2027-08-19",
      timeIn: "08:00",
      timeOut: "12:00",
    });
    expect(edited.status).toBe(400);
    expect(edited.body.message).toContain("approved and can no longer be changed");
    mockState.email = null;
  });

  it("the admin session can't edit entries (that's a separate feature)", async () => {
    mockState.email = null;
    const created = await newEntry({ date: "2027-08-20" });
    const id = created.body.id as string;

    mockState.email = ADMIN_EMAIL;
    const edited = await api("PATCH", `/time-entries/${id}`, {
      clientId: CLIENT_ID,
      date: "2027-08-20",
      timeIn: "08:00",
      timeOut: "12:00",
    });
    expect(edited.status).toBe(403);
    mockState.email = null;
  });
});
