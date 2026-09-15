// The one-time correction that moves non-visit and hospice to hourly pricing.
//
// Run against the real database because the half that matters is the entry
// rescale. Flipping the unit on its own would reprice work Molly has already
// approved — the same stored quantity means whole units under the old reading
// and 15-minute blocks under the new one — and that only shows up against
// real rows.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  visitTypesTable,
  timeEntriesTable,
  appliedBackfillsTable,
} from "@workspace/db";
import { backfillHourlyNonVisitAndHospice, ensureVisitTypesSeeded } from "./visit-types";
import { billableUnits } from "./payroll-calc";

const MARKER = "hourly-non-visit-and-hospice";
const HOURLY_KEYS = ["non-visit", "hospice"];
const createdIds: number[] = [];

async function addEntry(visitType: string, quantity: number) {
  const [row] = await db
    .insert(timeEntriesTable)
    .values({
      employeeId: "e2e-hourly-backfill",
      employeeName: "Hourly Backfill",
      employeeRole: "RN",
      clientId: "1",
      clientName: "St. Luke's Health System",
      date: "2029-06-04",
      visitType,
      quantity,
    })
    .returning();
  createdIds.push(row!.id);
  return row!;
}

async function quantityOf(id: number): Promise<number> {
  const [row] = await db.select().from(timeEntriesTable).where(eq(timeEntriesTable.id, id));
  return row!.quantity;
}

async function typeRow(key: string) {
  const [row] = await db.select().from(visitTypesTable).where(eq(visitTypesTable.key, key));
  return row!;
}

/** Put the catalog back the way a database seeded before this change looked. */
async function asPerVisitAgain() {
  await db.delete(appliedBackfillsTable).where(eq(appliedBackfillsTable.name, MARKER));
  await db
    .update(visitTypesTable)
    .set({ billingUnit: "visit", incrementMinutes: 15 })
    .where(inArray(visitTypesTable.key, HOURLY_KEYS));
}

beforeAll(async () => {
  await ensureVisitTypesSeeded();
});

afterAll(async () => {
  if (createdIds.length > 0) {
    await db.delete(timeEntriesTable).where(inArray(timeEntriesTable.id, createdIds));
  }
  // Leave the catalog and the marker exactly as a booted server would.
  await db
    .update(visitTypesTable)
    .set({ billingUnit: "increment", incrementMinutes: 15 })
    .where(inArray(visitTypesTable.key, HOURLY_KEYS));
  await db.insert(appliedBackfillsTable).values({ name: MARKER }).onConflictDoNothing();
  await pool.end();
});

describe("backfillHourlyNonVisitAndHospice", () => {
  it("turns both types hourly and rescales the entries already filed", async () => {
    await asPerVisitAgain();
    const nonVisit = await addEntry("non-visit", 2);
    const hospice = await addEntry("hospice", 1);

    const result = await backfillHourlyNonVisitAndHospice();

    expect([...result.typesFlipped].sort()).toEqual(["hospice", "non-visit"]);
    expect(result.entriesRescaled).toBeGreaterThanOrEqual(2);
    for (const key of HOURLY_KEYS) {
      const row = await typeRow(key);
      expect(row.billingUnit).toBe("increment");
      expect(row.incrementMinutes).toBe(15);
    }
    // Two units becomes eight 15-minute blocks; one becomes four.
    expect(await quantityOf(nonVisit.id)).toBe(8);
    expect(await quantityOf(hospice.id)).toBe(4);
  });

  it("leaves an approved entry priced at exactly the amount it already had", async () => {
    await asPerVisitAgain();
    const entry = await addEntry("non-visit", 2);
    const before = 2 * 84; // two units at St. Luke's RN non-visit rate

    await backfillHourlyNonVisitAndHospice();

    const after =
      billableUnits({ quantity: await quantityOf(entry.id) }, await typeRow("non-visit")) * 84;
    expect(after).toBeCloseTo(before, 2);
  });

  it("runs once: a later boot rescales nothing", async () => {
    await asPerVisitAgain();
    await backfillHourlyNonVisitAndHospice();
    const entry = await addEntry("non-visit", 6);

    const second = await backfillHourlyNonVisitAndHospice();

    expect(second).toEqual({ typesFlipped: [], entriesRescaled: 0 });
    expect(await quantityOf(entry.id)).toBe(6);
  });

  it("leaves a unit Molly has already set herself alone", async () => {
    await asPerVisitAgain();
    // She has made non-visit hourly in half-hour steps; her entries are
    // already counted in her own blocks and must not be rescaled.
    await db
      .update(visitTypesTable)
      .set({ billingUnit: "increment", incrementMinutes: 30 })
      .where(eq(visitTypesTable.key, "non-visit"));
    const hers = await addEntry("non-visit", 2);

    const result = await backfillHourlyNonVisitAndHospice();

    expect(result.typesFlipped).toEqual(["hospice"]);
    expect(await quantityOf(hers.id)).toBe(2);
    const row = await typeRow("non-visit");
    expect(row.incrementMinutes).toBe(30);
  });
});
