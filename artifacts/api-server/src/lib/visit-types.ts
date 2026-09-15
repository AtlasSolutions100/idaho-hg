import { sql, eq } from "drizzle-orm";
import {
  db,
  visitTypesTable,
  appliedBackfillsTable,
  timeEntriesTable,
  type VisitTypeRow,
} from "@workspace/db";
import type { VisitTypeUnit } from "./payroll-calc";

/** How a visit type is counted and priced. */
export type BillingUnit = "visit" | "increment";

export type SeedVisitType = {
  key: string;
  label: string;
  abbreviation: string;
  sortOrder: number;
  /** Discipline keys allowed to log it; omitted/empty = every discipline. */
  disciplines?: string[];
  billingUnit?: BillingUnit;
  incrementMinutes?: number;
};

// The visit types that used to be a hardcoded enum. Seeded once into the
// admin-managed catalog so existing entries/rates keep resolving and Molly
// starts from the known set — she can then add/rename/retire types herself.
//
// `disciplines` narrows a type to the professions that can actually perform
// it. Most St. Luke's visits (SOC, eval, recert, discharge, …) are the same
// visit for every discipline and differ only in rate, so they stay open to
// all. The four discipline-specific ones exist precisely because they name a
// profession, and padding every employee's list with the other three was the
// clutter Molly asked us to remove.
export const SEED_VISIT_TYPES: SeedVisitType[] = [
  { key: "soc", label: "Start of Care (SOC)", abbreviation: "SOC", sortOrder: 10 },
  { key: "routine-visit", label: "Routine Visit", abbreviation: "SNV", sortOrder: 20 },
  { key: "skilled-nursing", label: "Skilled Nursing (SNV)", abbreviation: "SNV", sortOrder: 30, disciplines: ["RN", "LPN"] },
  { key: "physical-therapy", label: "Physical Therapy (PTV)", abbreviation: "PT visit", sortOrder: 40, disciplines: ["PT", "PTA"] },
  { key: "occupational-therapy", label: "Occupational Therapy", abbreviation: "OT visit", sortOrder: 50, disciplines: ["OT", "COTA"] },
  { key: "speech-therapy", label: "Speech Therapy", abbreviation: "ST visit", sortOrder: 60, disciplines: ["SLP"] },
  { key: "eval", label: "Eval / Eval RA", abbreviation: "Eval", sortOrder: 70 },
  { key: "recert", label: "Recert / Recert RA", abbreviation: "Recert", sortOrder: 80 },
  { key: "roc", label: "Resumption of Care (ROC)", abbreviation: "ROC", sortOrder: 90 },
  { key: "discharge", label: "Discharge (DC)", abbreviation: "DC", sortOrder: 100 },
  // Hourly, logged in 15-minute steps, like Hospital at Home. Molly's PT
  // payroll sample logs non-visit as 0.25 and pays $18.80 (0.25 x $75.20),
  // and her St. Luke's invoice 1189 bills Ronda Stewart "NV/H@H 5.5 x $84" —
  // one hourly line covering non-visit and Hospital at Home together.
  { key: "non-visit", label: "Non-visit (doc/meeting)", abbreviation: "Non-visit", sortOrder: 110, billingUnit: "increment", incrementMinutes: 15 },
  // Paid and billed BY THE HOUR, logged in 15-minute steps (Molly confirmed,
  // 2026-09-15): $84/hr billed and $67.20/hr paid for nursing, $94/$75.20 for
  // PT/OT/SLP, typically two hours or more. "increment" means the rate is
  // hourly and `incrementMinutes` is only how finely time is logged — see
  // billableUnits() in payroll-calc.ts.
  { key: "hospital-at-home", label: "Hospital at Home", abbreviation: "Hospital at Home", sortOrder: 120, billingUnit: "increment", incrementMinutes: 15 },
  // Drive time on a Hospital at Home or hospice shift. St. Luke's pays for it
  // only then, for any discipline, at the Hospital at Home rate, in 15-minute
  // steps, on its own invoice line — with mileage billed on top, as for every
  // visit (Molly, 2026-09-15). The $33.60 on her sample RN payroll sheet was a
  // leftover in the template, not a rate.
  { key: "drive-time", label: "Drive Time", abbreviation: "Drive time", sortOrder: 125, billingUnit: "increment", incrementMinutes: 15 },
  // Hourly too: her RN payroll and reconciliation sheets record hospice in a
  // single hourly column headed "Non visit/HAH/HOS" at the Hospital at Home
  // rate, and Molly treats hospice and Hospital at Home alike for drive time.
  { key: "hospice", label: "Hospice", abbreviation: "Hospice", sortOrder: 130, billingUnit: "increment", incrementMinutes: 15 },
  { key: "training", label: "Training", abbreviation: "Training", sortOrder: 140 },
  { key: "non-billable", label: "Non-billable Visit", abbreviation: "Non-billable", sortOrder: 150 },
  { key: "on-call", label: "On Call", abbreviation: "On call", sortOrder: 160 },
  { key: "mccall-per-diem", label: "McCall Per Diem", abbreviation: "McCall Per diem", sortOrder: 170 },
  { key: "mie-first-last-day", label: "MI&E First/Last Day", abbreviation: "MI&E first/last day", sortOrder: 180 },
  { key: "mie-full-day", label: "MI&E Full Day", abbreviation: "MI&E full day", sortOrder: 190 },
];

/** Comma-separated column value -> array of discipline keys. */
export function parseDisciplines(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
}

/** Array of discipline keys -> the stored column value (null = all). */
export function serializeDisciplinesColumn(list: string[] | undefined): string | null {
  if (!list || list.length === 0) return null;
  const cleaned = [...new Set(list.map((d) => d.trim()).filter(Boolean))];
  return cleaned.length > 0 ? cleaned.join(",") : null;
}

/**
 * Whether an employee of `discipline` may log this visit type. A type with no
 * discipline list is open to everyone, and a caller whose discipline we don't
 * know (the signed-out web demo) sees everything rather than an empty list.
 */
export function visitTypeAllowsDiscipline(
  row: Pick<VisitTypeRow, "disciplines">,
  discipline: string | null | undefined,
): boolean {
  const list = parseDisciplines(row.disciplines);
  if (list.length === 0) return true;
  if (!discipline) return true;
  return list.some((d) => d.toUpperCase() === discipline.trim().toUpperCase());
}

// Same advisory-lock pattern as the client-rate backfill: the seed is
// insert-if-missing, so concurrent instances/tests can't double-insert.
const VISIT_TYPES_SEED_LOCK_KEY = 727_301_633;

let seededVisitTypes = false;

/** Populate the catalog with the known visit types on first use (idempotent). */
export async function ensureVisitTypesSeeded(): Promise<void> {
  if (seededVisitTypes) return;
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${VISIT_TYPES_SEED_LOCK_KEY})`);
    const existing = await tx.select().from(visitTypesTable);
    const have = new Set(existing.map((r) => r.key));
    const missing = SEED_VISIT_TYPES.filter((t) => !have.has(t.key));
    if (missing.length > 0) {
      await tx.insert(visitTypesTable).values(
        missing.map((t) => ({
          key: t.key,
          label: t.label,
          abbreviation: t.abbreviation,
          sortOrder: t.sortOrder,
          disciplines: serializeDisciplinesColumn(t.disciplines),
          billingUnit: t.billingUnit ?? "visit",
          incrementMinutes: t.incrementMinutes ?? 15,
        })),
      );
    }
  });
  // Before the older unit backfill: that one would flip these two types to
  // hourly from the seed without converting the entries already filed
  // against them, which is exactly what this correction exists to do.
  await backfillHourlyNonVisitAndHospice();
  await backfillVisitTypeDisciplinesAndUnits();
  seededVisitTypes = true;
}

/** Reset the in-process seed guard. Tests only. */
export function resetVisitTypeSeedCache(): void {
  seededVisitTypes = false;
}

/**
 * Non-visit and hospice were seeded as flat per-visit types. Molly's own
 * records price them by the hour — her PT payroll sample pays 0.25 of an hour
 * as $18.80, and invoice 1189 bills 5.5 hours of "NV/H@H" at $84 — so they
 * move to the same hourly, 15-minute-step unit as Hospital at Home.
 *
 * Flipping the unit alone would silently reprice every entry already filed:
 * `quantity` on those rows counts whole units, and the hourly reading treats
 * the same number as 15-minute blocks, so an approved 2 would drop from
 * 2 x $84 to half an hour. Each entry's quantity is therefore scaled by the
 * number of blocks in an hour in the same transaction, which leaves every
 * existing entry priced at exactly the dollar amount it already had while
 * letting quarter hours be logged from now on.
 *
 * Runs once per database, and only for a type Molly has left per-visit: if
 * she has already set the unit herself, her entries are already in her unit
 * and are not touched. Returns what it changed.
 */
export async function backfillHourlyNonVisitAndHospice(): Promise<{
  typesFlipped: string[];
  entriesRescaled: number;
}> {
  return db.transaction(async (tx) => {
    const [marker] = await tx
      .insert(appliedBackfillsTable)
      .values({ name: "hourly-non-visit-and-hospice" })
      .onConflictDoNothing()
      .returning();
    if (!marker) return { typesFlipped: [], entriesRescaled: 0 };

    const typesFlipped: string[] = [];
    let entriesRescaled = 0;
    for (const key of ["non-visit", "hospice"]) {
      const [row] = await tx
        .select()
        .from(visitTypesTable)
        .where(eq(visitTypesTable.key, key));
      if (!row || row.billingUnit !== "visit") continue;

      const minutes = row.incrementMinutes > 0 ? row.incrementMinutes : 15;
      await tx
        .update(visitTypesTable)
        .set({ billingUnit: "increment", incrementMinutes: minutes })
        .where(eq(visitTypesTable.key, key));
      typesFlipped.push(key);

      const blocksPerHour = 60 / minutes;
      const rescaled = await tx
        .update(timeEntriesTable)
        .set({ quantity: sql`${timeEntriesTable.quantity} * ${blocksPerHour}` })
        .where(eq(timeEntriesTable.visitType, key))
        .returning({ id: timeEntriesTable.id });
      entriesRescaled += rescaled.length;
    }
    return { typesFlipped, entriesRescaled };
  });
}

/**
 * One-time backfill for databases seeded before visit types carried a
 * discipline list or a billing unit: every row already existed, so the
 * insert-if-missing seed above skipped them and they kept the column defaults
 * (open to all disciplines, billed per visit).
 *
 * Applied exactly once per database via the applied_backfills marker, so
 * anything Molly changes afterwards is never stomped.
 */
export async function backfillVisitTypeDisciplinesAndUnits(): Promise<void> {
  const inserted = await db
    .insert(appliedBackfillsTable)
    .values({ name: "visit-type-disciplines-and-units" })
    .onConflictDoNothing()
    .returning();
  if (inserted.length === 0) return; // already applied
  for (const seed of SEED_VISIT_TYPES) {
    const disciplines = serializeDisciplinesColumn(seed.disciplines);
    const billingUnit = seed.billingUnit ?? "visit";
    // Skip the types whose seeded shape is just the column defaults — there
    // is nothing to correct, and not writing keeps the update list honest.
    if (disciplines == null && billingUnit === "visit") continue;
    await db
      .update(visitTypesTable)
      .set({
        ...(disciplines != null ? { disciplines } : {}),
        billingUnit,
        incrementMinutes: seed.incrementMinutes ?? 15,
      })
      .where(eq(visitTypesTable.key, seed.key));
  }
}

/** All visit-type rows, catalog order (sortOrder then label). */
export async function listVisitTypeRows(): Promise<VisitTypeRow[]> {
  await ensureVisitTypesSeeded();
  const rows = await db.select().from(visitTypesTable);
  return rows.sort(
    (a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label),
  );
}

/** Set of valid visit-type keys (active + inactive), for write validation. */
export async function getVisitTypeKeySet(): Promise<Set<string>> {
  const rows = await listVisitTypeRows();
  return new Set(rows.map((r) => r.key));
}

/** key -> row, for write paths that need a type's unit or discipline list. */
export async function getVisitTypeMap(): Promise<Map<string, VisitTypeRow>> {
  const rows = await listVisitTypeRows();
  return new Map(rows.map((r) => [r.key, r]));
}

/**
 * key -> just the pricing unit, for the payroll and invoice math. Separate
 * from getVisitTypeMap so the pure calc functions depend on two fields rather
 * than the whole database row.
 */
export async function visitTypeUnitMap(): Promise<Map<string, VisitTypeUnit>> {
  const rows = await listVisitTypeRows();
  return new Map(
    rows.map((r) => [
      r.key,
      { billingUnit: r.billingUnit, incrementMinutes: r.incrementMinutes },
    ]),
  );
}

/** "Start of Care!" -> "start-of-care". Used when a new type omits an explicit key. */
export function slugifyVisitTypeKey(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function serializeVisitType(row: VisitTypeRow) {
  return {
    key: row.key,
    label: row.label,
    abbreviation: row.abbreviation,
    active: row.active,
    sortOrder: row.sortOrder,
    disciplines: parseDisciplines(row.disciplines),
    billingUnit: row.billingUnit as BillingUnit,
    incrementMinutes: row.incrementMinutes,
  };
}
