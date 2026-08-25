// End-to-end test for the startup backfill: clients added after the original
// seed (Current PT, Thrive) must be inserted into an already-populated
// database — the full seed only runs on an empty database. We simulate the
// pre-backfill state by deleting the rows directly, then hit the API (which
// triggers ensureRosterSeeded / ensureSeeded in this fresh test process) and
// assert the clients and their hourly-PT rates come back without duplicates.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "node:http";
import { inArray, and, eq } from "drizzle-orm";
import { db, pool, clientsTable, clientRatesTable, appliedBackfillsTable } from "@workspace/db";
import { backfillStLukesVisitBilling } from "./roster";

// GET /client-rates is admin-only now, so this suite reads it as Molly (GET
// /clients stays public). Clerk is mocked at the @clerk/express boundary.
const mockState: { email: string | null } = { email: null };
vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: () => (mockState.email ? { userId: "user_roster_backfill_e2e" } : null),
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
}));
const ADMIN_EMAIL = "admin-roster-backfill-e2e@example.com";
process.env.ADMIN_EMAIL = ADMIN_EMAIL;
const { default: app } = await import("../app");

let server: Server;
let baseUrl: string;

const BACKFILL_IDS = ["6", "7"];

beforeAll(async () => {
  // GET /client-rates is admin-only; read everything here as Molly (GET
  // /clients is public and unaffected by the session).
  mockState.email = ADMIN_EMAIL;
  // Simulate a live database from before Current PT / Thrive existed.
  await db
    .delete(clientRatesTable)
    .where(inArray(clientRatesTable.clientId, BACKFILL_IDS));
  await db.delete(clientsTable).where(inArray(clientsTable.id, BACKFILL_IDS));

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address();
  if (address == null || typeof address === "string") throw new Error("No server port");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await pool.end();
});

async function get(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}/api${path}`);
  return { status: res.status, body: await res.json() };
}

describe("backfill of later-added clients into a populated database", () => {
  it("re-inserts Current PT and Thrive with their hourly-PT rates", async () => {
    // Sanity: the database is populated (original seed clients exist).
    const preexisting = await db.select().from(clientsTable);
    expect(preexisting.length).toBeGreaterThan(0);

    const clients = await get("/clients");
    expect(clients.status).toBe(200);
    const names = clients.body.map((c: { name: string }) => c.name);
    expect(names).toContain("Current PT");
    expect(names).toContain("Thrive");
    const currentPt = clients.body.find((c: { name: string }) => c.name === "Current PT");
    const thrive = clients.body.find((c: { name: string }) => c.name === "Thrive");
    expect(currentPt.id).toBe("6");
    expect(thrive.id).toBe("7");

    const rates = await get("/client-rates");
    expect(rates.status).toBe(200);
    const currentPtRate = rates.body.find(
      (r: { clientId: string; visitType: string }) =>
        r.clientId === "6" && r.visitType === "hourly-PT",
    );
    const thriveRate = rates.body.find(
      (r: { clientId: string; visitType: string }) =>
        r.clientId === "7" && r.visitType === "hourly-PT",
    );
    expect(currentPtRate?.rate).toBe(69);
    expect(thriveRate?.rate).toBe(69.98);
  });

  it("does not duplicate clients or rates on repeated requests", async () => {
    await get("/clients");
    await get("/client-rates");

    const clientRows = await db
      .select()
      .from(clientsTable)
      .where(inArray(clientsTable.id, BACKFILL_IDS));
    expect(clientRows).toHaveLength(2);

    for (const clientId of BACKFILL_IDS) {
      const rateRows = await db
        .select()
        .from(clientRatesTable)
        .where(
          and(
            eq(clientRatesTable.clientId, clientId),
            eq(clientRatesTable.visitType, "hourly-PT"),
          ),
        );
      expect(rateRows).toHaveLength(1);
    }
  });

  it("preserves preexisting seed clients", async () => {
    const clients = await get("/clients");
    const names = clients.body.map((c: { name: string }) => c.name);
    expect(names).toContain("St. Luke's Health System");
    expect(names).toContain("Weiser Memorial Hospital");
  });
});

describe("one-time St. Luke's visit-billing backfill", () => {
  const MARKER = "st-lukes-bills-by-visit-type";

  it("turns on visit billing for St. Luke's exactly once, then respects admin changes", async () => {
    // Simulate a database from before the column existed: flag false, no marker.
    await db.delete(appliedBackfillsTable).where(eq(appliedBackfillsTable.name, MARKER));
    await db
      .update(clientsTable)
      .set({ billsByVisitType: false })
      .where(eq(clientsTable.id, "1"));

    await backfillStLukesVisitBilling();
    let [stLukes] = await db.select().from(clientsTable).where(eq(clientsTable.id, "1"));
    expect(stLukes?.billsByVisitType).toBe(true);

    // A later admin decision to turn it off must NOT be stomped on restart.
    await db
      .update(clientsTable)
      .set({ billsByVisitType: false })
      .where(eq(clientsTable.id, "1"));
    await backfillStLukesVisitBilling();
    [stLukes] = await db.select().from(clientsTable).where(eq(clientsTable.id, "1"));
    expect(stLukes?.billsByVisitType).toBe(false);

    // Restore the real state: St. Luke's bills by visit type.
    await db
      .update(clientsTable)
      .set({ billsByVisitType: true })
      .where(eq(clientsTable.id, "1"));
  });
});
