// One-time corrections to rates the app seeded wrong, run against the real
// database because the part most likely to go quietly wrong is the SQL: the
// rate column is single precision, so matching "rate = 33.6" finds nothing and
// the correction would report success while changing no one's pay.
import { describe, it, expect, afterAll, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db, pool, visitPayRatesTable, appliedBackfillsTable } from "@workspace/db";

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: () => null,
  clerkClient: {
    users: {
      getUser: async () => ({ primaryEmailAddress: null, emailAddresses: [] }),
      getUserList: async () => ({ data: [] }),
      createUser: async () => ({ id: "user_rates_corrections" }),
    },
    sessions: {
      getSessionList: async () => ({ data: [] }),
      revokeSession: async () => ({}),
    },
  },
}));

// Load the app first. lib/employee-auth and routes/roster import each other,
// and entering through ./rates initialises them in an order where roster
// builds its router before requireAdmin exists. The app loads them in the
// order production does.
await import("../app");
const { backfillDriveTimePayRate } = await import("./rates");

const MARKER = "drive-time-pays-hospital-at-home-rate";
const insertedIds: number[] = [];

async function insertDriveTimeRate(rate: number, effectiveDate: string) {
  const [row] = await db
    .insert(visitPayRatesTable)
    .values({ discipline: "RN", visitType: "drive-time", rate, effectiveDate })
    .returning();
  insertedIds.push(row!.id);
  return row!;
}

async function rateOf(id: number) {
  const [row] = await db.select().from(visitPayRatesTable).where(eq(visitPayRatesTable.id, id));
  return row!.rate;
}

/** As if on a database the correction has never run against. */
async function runOnFreshDatabase() {
  await db.delete(appliedBackfillsTable).where(eq(appliedBackfillsTable.name, MARKER));
  return backfillDriveTimePayRate();
}

afterAll(async () => {
  if (insertedIds.length > 0) {
    await db.delete(visitPayRatesTable).where(inArray(visitPayRatesTable.id, insertedIds));
  }
  // Leave the marker set, exactly as a booted server would.
  await db.insert(appliedBackfillsTable).values({ name: MARKER }).onConflictDoNothing();
  await pool.end();
});

describe("backfillDriveTimePayRate", () => {
  it("corrects the $33.60 RN drive-time row to the Hospital at Home rate", async () => {
    const seeded = await insertDriveTimeRate(33.6, "2024-01-01");
    expect(await runOnFreshDatabase()).toBeGreaterThanOrEqual(1);
    expect(await rateOf(seeded.id)).toBeCloseTo(67.2, 2);
  });

  it("runs once: a later boot changes nothing", async () => {
    const seeded = await insertDriveTimeRate(33.6, "2024-01-01");
    await runOnFreshDatabase();
    await db.update(visitPayRatesTable).set({ rate: 33.6 }).where(eq(visitPayRatesTable.id, seeded.id));
    expect(await backfillDriveTimePayRate()).toBe(0);
    expect(await rateOf(seeded.id)).toBeCloseTo(33.6, 2);
  });

  it("leaves a drive-time rate Molly set herself alone", async () => {
    const hers = await insertDriveTimeRate(70, "2026-09-06");
    await runOnFreshDatabase();
    expect(await rateOf(hers.id)).toBeCloseTo(70, 2);
  });
});
