// End-to-end tests for self-serve profile linking (task: let new employees
// link themselves instead of Molly typing every email).
//
// Flow under test: a person signs in with an email Molly never entered →
// /me returns 403 NOT_LINKED → they list claimable names and claim one →
// /me returns 403 LINK_REQUEST_PENDING → Molly approves → the email is on
// the profile and access works. Deny keeps them blocked. Profiles that
// already have an email can't be claimed, and a claimant's own session can
// never approve a request.
//
// Clerk is mocked at the @clerk/express boundary (never global fetch).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { vi } from "vitest";
import type { Server } from "node:http";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  employeesTable,
  employeeLinkRequestsTable,
  timeEntriesTable,
} from "@workspace/db";

const mockState: { email: string | null } = { email: null };

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: () => (mockState.email ? { userId: "user_link_e2e" } : null),
  clerkClient: {
    users: {
      getUser: async () => ({
        primaryEmailAddress: { emailAddress: mockState.email },
        emailAddresses: [{ emailAddress: mockState.email }],
      }),
      getUserList: async () => ({ data: [{ id: "user_link_e2e" }] }),
      createUser: async () => ({ id: "user_link_e2e" }),
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

const UNLINKED_ID = "e2e-link-unlinked-employee";
const LINKED_ID = "e2e-link-linked-employee";
const LINKED_EMAIL = "already-linked-e2e@example.com";
const NEW_EMAIL = "new-person-link-e2e@example.com";
const ADMIN_EMAIL = "admin-link-e2e@example.com";
process.env.ADMIN_EMAIL = ADMIN_EMAIL;

async function cleanup() {
  await db
    .delete(employeeLinkRequestsTable)
    .where(inArray(employeeLinkRequestsTable.email, [NEW_EMAIL, LINKED_EMAIL, ADMIN_EMAIL]));
  await db
    .delete(timeEntriesTable)
    .where(inArray(timeEntriesTable.employeeId, [UNLINKED_ID, LINKED_ID]));
  await db
    .delete(employeesTable)
    .where(inArray(employeesTable.id, [UNLINKED_ID, LINKED_ID]));
  await db
    .delete(employeesTable)
    .where(inArray(employeesTable.email, [NEW_EMAIL, LINKED_EMAIL]));
}

beforeAll(async () => {
  await cleanup();
  await db.insert(employeesTable).values([
    { id: UNLINKED_ID, name: "Unlinked Link E2E", role: "RN", email: null },
    { id: LINKED_ID, name: "Linked Link E2E", role: "PT", email: LINKED_EMAIL },
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

describe("self-serve profile linking", () => {
  it("an unlinked signed-in email gets NOT_LINKED and can list claimable names", async () => {
    mockState.email = NEW_EMAIL;

    const me = await api("GET", "/me");
    expect(me.status).toBe(403);
    expect(me.body.code).toBe("NOT_LINKED");

    const claimable = await api("GET", "/link-requests/claimable");
    expect(claimable.status).toBe(200);
    const ids = claimable.body.map((e: { id: string }) => e.id);
    expect(ids).toContain(UNLINKED_ID);
    // Profiles that already have an email are not claimable.
    expect(ids).not.toContain(LINKED_ID);
  });

  it("claimable list and claims require a session", async () => {
    mockState.email = null;
    const claimable = await api("GET", "/link-requests/claimable");
    expect(claimable.status).toBe(401);
    const claim = await api("POST", "/link-requests", { employeeId: UNLINKED_ID });
    expect(claim.status).toBe(401);
  });

  it("claiming a profile creates a pending request and flips /me to LINK_REQUEST_PENDING", async () => {
    mockState.email = NEW_EMAIL;

    const claim = await api("POST", "/link-requests", { employeeId: UNLINKED_ID });
    expect(claim.status).toBe(201);
    expect(claim.body.employeeId).toBe(UNLINKED_ID);
    expect(claim.body.email).toBe(NEW_EMAIL);

    // Claiming again is idempotent — same pending request comes back.
    const again = await api("POST", "/link-requests", { employeeId: UNLINKED_ID });
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(claim.body.id);

    const me = await api("GET", "/me");
    expect(me.status).toBe(403);
    expect(me.body.code).toBe("LINK_REQUEST_PENDING");

    // Still no access to time entries while pending.
    const entry = await api("POST", "/time-entries", {
      employeeId: UNLINKED_ID,
      clientId: "1",
      date: "2026-05-12",
      hours: 2,
      isWeekend: false,
      isHoliday: false,
    });
    expect(entry.status).toBe(403);
    expect(entry.body.code).toBe("LINK_REQUEST_PENDING");
  });

  it("a second person can't claim an already-claimed profile, and it drops off the claimable list", async () => {
    mockState.email = "second-claimant-e2e@example.com";
    const claimable = await api("GET", "/link-requests/claimable");
    expect(claimable.status).toBe(200);
    const ids = claimable.body.map((e: { id: string }) => e.id);
    expect(ids).not.toContain(UNLINKED_ID); // pending claim hides it

    const claim = await api("POST", "/link-requests", { employeeId: UNLINKED_ID });
    expect(claim.status).toBe(409);
    expect(claim.body.message).toContain("Someone already asked");
  });

  it("a claimant's own session cannot list or approve requests", async () => {
    mockState.email = NEW_EMAIL;
    const [request] = await db
      .select()
      .from(employeeLinkRequestsTable)
      .where(eq(employeeLinkRequestsTable.email, NEW_EMAIL));
    expect(request).toBeDefined();

    const list = await api("GET", "/link-requests");
    expect(list.status).toBe(403);
    expect(list.body.message).toContain("Only Molly");

    const approve = await api("POST", `/link-requests/${request.id}/approve`);
    expect(approve.status).toBe(403);
    const deny = await api("POST", `/link-requests/${request.id}/deny`);
    expect(deny.status).toBe(403);

    // Nothing changed.
    const [row] = await db
      .select()
      .from(employeesTable)
      .where(eq(employeesTable.id, UNLINKED_ID));
    expect(row.email).toBeNull();
  });

  it("anonymous callers get 401 for list, approve, and deny", async () => {
    const [request] = await db
      .select()
      .from(employeeLinkRequestsTable)
      .where(eq(employeeLinkRequestsTable.email, NEW_EMAIL));
    expect(request).toBeDefined();

    mockState.email = null;
    const list = await api("GET", "/link-requests");
    expect(list.status).toBe(401);
    const approve = await api("POST", `/link-requests/${request.id}/approve`);
    expect(approve.status).toBe(401);
    const deny = await api("POST", `/link-requests/${request.id}/deny`);
    expect(deny.status).toBe(401);

    // Request untouched, profile still unlinked.
    const [still] = await db
      .select()
      .from(employeeLinkRequestsTable)
      .where(eq(employeeLinkRequestsTable.id, request.id));
    expect(still).toBeDefined();
    const [row] = await db
      .select()
      .from(employeesTable)
      .where(eq(employeesTable.id, UNLINKED_ID));
    expect(row.email).toBeNull();
  });

  it("without a configured admin, even a signed-in caller can't approve (fail closed)", async () => {
    const [request] = await db
      .select()
      .from(employeeLinkRequestsTable)
      .where(eq(employeeLinkRequestsTable.email, NEW_EMAIL));
    expect(request).toBeDefined();

    const saved = process.env.ADMIN_EMAIL;
    delete process.env.ADMIN_EMAIL;
    try {
      mockState.email = ADMIN_EMAIL;
      const approve = await api("POST", `/link-requests/${request.id}/approve`);
      expect(approve.status).toBe(403);
    } finally {
      process.env.ADMIN_EMAIL = saved;
    }
  });

  it("denying removes the request; the person is back to NOT_LINKED", async () => {
    mockState.email = ADMIN_EMAIL;
    const list = await api("GET", "/link-requests");
    expect(list.status).toBe(200);
    const request = list.body.find((r: { email: string }) => r.email === NEW_EMAIL);
    expect(request).toBeDefined();
    expect(request.employeeName).toBe("Unlinked Link E2E");

    const deny = await api("POST", `/link-requests/${request.id}/deny`);
    expect(deny.status).toBe(200);

    // Denying twice → 404 (already handled).
    const denyAgain = await api("POST", `/link-requests/${request.id}/deny`);
    expect(denyAgain.status).toBe(404);

    mockState.email = NEW_EMAIL;
    const me = await api("GET", "/me");
    expect(me.status).toBe(403);
    expect(me.body.code).toBe("NOT_LINKED");
  });

  it("approving links the email and grants access", async () => {
    mockState.email = NEW_EMAIL;
    const claim = await api("POST", "/link-requests", { employeeId: UNLINKED_ID });
    expect(claim.status).toBe(201);

    mockState.email = ADMIN_EMAIL;
    const approve = await api("POST", `/link-requests/${claim.body.id}/approve`);
    expect(approve.status).toBe(200);
    expect(approve.body.id).toBe(UNLINKED_ID);
    expect(approve.body.email).toBe(NEW_EMAIL);

    mockState.email = NEW_EMAIL;
    const me = await api("GET", "/me");
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(UNLINKED_ID);

    const entry = await api("POST", "/time-entries", {
      employeeId: UNLINKED_ID,
      clientId: "1",
      date: "2026-05-13",
      hours: 3,
      isWeekend: false,
      isHoliday: false,
    });
    expect(entry.status).toBe(201);
    expect(entry.body.employeeId).toBe(UNLINKED_ID);
  });

  it("a linked profile can't be claimed, and a linked email can't claim", async () => {
    // A fresh email trying to claim the (now linked) profile.
    mockState.email = "someone-else-link-e2e@example.com";
    const claimLinked = await api("POST", "/link-requests", { employeeId: UNLINKED_ID });
    expect(claimLinked.status).toBe(409);
    expect(claimLinked.body.message).toContain("already has a sign-in email");

    // An email that already belongs to a profile has nothing to claim.
    mockState.email = LINKED_EMAIL;
    const claimAsLinked = await api("POST", "/link-requests", { employeeId: UNLINKED_ID });
    expect(claimAsLinked.status).toBe(409);
  });

  it("approve fails safely when the profile got an email in the meantime", async () => {
    // New unlinked profile + a pending claim for it.
    const RACE_ID = "e2e-link-race-employee";
    const raceEmail = "race-link-e2e@example.com";
    await db.delete(employeesTable).where(eq(employeesTable.id, RACE_ID));
    await db
      .delete(employeeLinkRequestsTable)
      .where(eq(employeeLinkRequestsTable.email, raceEmail));
    await db
      .insert(employeesTable)
      .values({ id: RACE_ID, name: "Race Link E2E", role: "OT", email: null });

    mockState.email = raceEmail;
    const claim = await api("POST", "/link-requests", { employeeId: RACE_ID });
    expect(claim.status).toBe(201);

    // Meanwhile Molly types an email in manually (old path still works).
    await db
      .update(employeesTable)
      .set({ email: "manual-race-e2e@example.com" })
      .where(eq(employeesTable.id, RACE_ID));

    mockState.email = ADMIN_EMAIL;
    const approve = await api("POST", `/link-requests/${claim.body.id}/approve`);
    expect(approve.status).toBe(409);

    // The stale request is gone and the manual email survived.
    const [row] = await db
      .select()
      .from(employeesTable)
      .where(eq(employeesTable.id, RACE_ID));
    expect(row.email).toBe("manual-race-e2e@example.com");
    const [gone] = await db
      .select()
      .from(employeeLinkRequestsTable)
      .where(eq(employeeLinkRequestsTable.id, claim.body.id));
    expect(gone).toBeUndefined();

    await db.delete(employeesTable).where(eq(employeesTable.id, RACE_ID));
  });

  it("concurrent approve + deny: exactly one wins", async () => {
    const RACE_ID = "e2e-link-approve-deny-race";
    const raceEmail = "approve-deny-race-e2e@example.com";
    await db.delete(employeesTable).where(eq(employeesTable.id, RACE_ID));
    await db
      .delete(employeeLinkRequestsTable)
      .where(eq(employeeLinkRequestsTable.email, raceEmail));
    await db
      .insert(employeesTable)
      .values({ id: RACE_ID, name: "ApproveDeny Race E2E", role: "RN", email: null });

    mockState.email = raceEmail;
    const claim = await api("POST", "/link-requests", { employeeId: RACE_ID });
    expect(claim.status).toBe(201);

    mockState.email = ADMIN_EMAIL;
    const [approve, deny] = await Promise.all([
      api("POST", `/link-requests/${claim.body.id}/approve`),
      api("POST", `/link-requests/${claim.body.id}/deny`),
    ]);
    // Exactly one of the two succeeds; the loser sees "already handled".
    const statuses = [approve.status, deny.status].sort();
    expect(statuses).toEqual([200, 404]);

    const [row] = await db
      .select()
      .from(employeesTable)
      .where(eq(employeesTable.id, RACE_ID));
    if (approve.status === 200) {
      expect(row.email).toBe(raceEmail); // approved → linked
    } else {
      expect(row.email).toBeNull(); // denied → still unlinked
    }
    // Either way the request is gone.
    const [gone] = await db
      .select()
      .from(employeeLinkRequestsTable)
      .where(eq(employeeLinkRequestsTable.id, claim.body.id));
    expect(gone).toBeUndefined();

    await db.delete(employeesTable).where(eq(employeesTable.id, RACE_ID));
  });

  it("concurrent approve + manual email edit end in a consistent state", async () => {
    const RACE_ID = "e2e-link-manual-race";
    const raceEmail = "manual-approve-race-e2e@example.com";
    const manualEmail = "typed-by-molly-race-e2e@example.com";
    await db.delete(employeesTable).where(eq(employeesTable.id, RACE_ID));
    await db
      .delete(employeeLinkRequestsTable)
      .where(eq(employeeLinkRequestsTable.email, raceEmail));
    await db
      .insert(employeesTable)
      .values({ id: RACE_ID, name: "Manual Race E2E", role: "OT", email: null });

    mockState.email = raceEmail;
    const claim = await api("POST", "/link-requests", { employeeId: RACE_ID });
    expect(claim.status).toBe(201);

    // Molly approves the claim and types an email in at the same time. Both
    // writers lock the employee row, so they serialize — whichever commits
    // second wins cleanly, and no pending request can survive.
    mockState.email = ADMIN_EMAIL;
    const [approve, manual] = await Promise.all([
      api("POST", `/link-requests/${claim.body.id}/approve`),
      api("PATCH", `/employees/${RACE_ID}`, { email: manualEmail }),
    ]);
    expect([200, 409]).toContain(approve.status);
    expect(manual.status).toBe(200);

    const [row] = await db
      .select()
      .from(employeesTable)
      .where(eq(employeesTable.id, RACE_ID));
    // The profile ends with one of the two emails — never null, never a mix.
    expect([raceEmail, manualEmail]).toContain(row.email);
    // No stale pending request remains under either ordering.
    const [gone] = await db
      .select()
      .from(employeeLinkRequestsTable)
      .where(eq(employeeLinkRequestsTable.id, claim.body.id));
    expect(gone).toBeUndefined();

    await db.delete(employeesTable).where(eq(employeesTable.id, RACE_ID));
  });

  it("Molly typing an email manually clears that profile's pending request", async () => {
    const MANUAL_ID = "e2e-link-manual-clear";
    const claimEmail = "manual-clear-claim-e2e@example.com";
    const typedEmail = "manual-clear-typed-e2e@example.com";
    await db.delete(employeesTable).where(eq(employeesTable.id, MANUAL_ID));
    await db
      .delete(employeeLinkRequestsTable)
      .where(eq(employeeLinkRequestsTable.email, claimEmail));
    await db
      .insert(employeesTable)
      .values({ id: MANUAL_ID, name: "Manual Clear E2E", role: "PT", email: null });

    mockState.email = claimEmail;
    const claim = await api("POST", "/link-requests", { employeeId: MANUAL_ID });
    expect(claim.status).toBe(201);

    // Old path still works: Molly types the email in directly.
    mockState.email = null;
    const manual = await api("PATCH", `/employees/${MANUAL_ID}`, { email: typedEmail });
    expect(manual.status).toBe(200);
    expect(manual.body.email).toBe(typedEmail);

    // The stale claim is gone; the claimant is back to NOT_LINKED.
    const [gone] = await db
      .select()
      .from(employeeLinkRequestsTable)
      .where(eq(employeeLinkRequestsTable.id, claim.body.id));
    expect(gone).toBeUndefined();
    mockState.email = claimEmail;
    const me = await api("GET", "/me");
    expect(me.status).toBe(403);
    expect(me.body.code).toBe("NOT_LINKED");

    await db.delete(employeesTable).where(eq(employeesTable.id, MANUAL_ID));
  });

  it("rejects a claim for an unknown or invalid employee", async () => {
    mockState.email = "invalid-claim-e2e@example.com";
    const missing = await api("POST", "/link-requests", { employeeId: "does-not-exist" });
    expect(missing.status).toBe(404);
    const bad = await api("POST", "/link-requests", {});
    expect(bad.status).toBe(400);
  });
});
