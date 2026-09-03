import { sql, eq } from "drizzle-orm";
import {
  db,
  visitTypesTable,
  appliedBackfillsTable,
  type VisitTypeRow,
} from "@workspace/db";

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
  { key: "non-visit", label: "Non-visit (doc/meeting)", abbreviation: "Non-visit", sortOrder: 110 },
  // Billed in 15-minute blocks rather than as one flat visit. The seeded rate
  // came off Molly's master sheet as a per-visit figure, so it needs
  // confirming as a per-block rate — the admin pay/rate screens label the
  // unit so the difference is visible where the number is entered.
  { key: "hospital-at-home", label: "Hospital at Home", abbreviation: "Hospital at Home", sortOrder: 120, billingUnit: "increment", incrementMinutes: 15 },
  { key: "drive-time", label: "Drive Time", abbreviation: "Drive time", sortOrder: 125, billingUnit: "increment", incrementMinutes: 15 },
  { key: "hospice", label: "Hospice", abbreviation: "Hospice", sortOrder: 130 },
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
  await backfillVisitTypeDisciplinesAndUnits();
  seededVisitTypes = true;
}

/** Reset the in-process seed guard. Tests only. */
export function resetVisitTypeSeedCache(): void {
  seededVisitTypes = false;
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
