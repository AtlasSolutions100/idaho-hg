import { sql } from "drizzle-orm";
import { db, visitTypesTable, type VisitTypeRow } from "@workspace/db";

// The visit types that used to be a hardcoded enum. Seeded once into the
// admin-managed catalog so existing entries/rates keep resolving and Molly
// starts from the known set — she can then add/rename/retire types herself.
export const SEED_VISIT_TYPES: Array<{
  key: string;
  label: string;
  abbreviation: string;
  sortOrder: number;
}> = [
  { key: "soc", label: "Start of Care (SOC)", abbreviation: "SOC", sortOrder: 10 },
  { key: "routine-visit", label: "Routine Visit", abbreviation: "SNV", sortOrder: 20 },
  { key: "skilled-nursing", label: "Skilled Nursing (SNV)", abbreviation: "SNV", sortOrder: 30 },
  { key: "physical-therapy", label: "Physical Therapy (PTV)", abbreviation: "PT visit", sortOrder: 40 },
  { key: "occupational-therapy", label: "Occupational Therapy", abbreviation: "OT visit", sortOrder: 50 },
  { key: "speech-therapy", label: "Speech Therapy", abbreviation: "ST visit", sortOrder: 60 },
  { key: "eval", label: "Eval / Eval RA", abbreviation: "Eval", sortOrder: 70 },
  { key: "recert", label: "Recert / Recert RA", abbreviation: "Recert", sortOrder: 80 },
  { key: "roc", label: "Resumption of Care (ROC)", abbreviation: "ROC", sortOrder: 90 },
  { key: "discharge", label: "Discharge (DC)", abbreviation: "DC", sortOrder: 100 },
  { key: "non-visit", label: "Non-visit (doc/meeting)", abbreviation: "Non-visit", sortOrder: 110 },
  { key: "hospital-at-home", label: "Hospital at Home", abbreviation: "Hospital at Home", sortOrder: 120 },
  { key: "hospice", label: "Hospice", abbreviation: "Hospice", sortOrder: 130 },
  { key: "training", label: "Training", abbreviation: "Training", sortOrder: 140 },
  { key: "non-billable", label: "Non-billable Visit", abbreviation: "Non-billable", sortOrder: 150 },
  { key: "on-call", label: "On Call", abbreviation: "On call", sortOrder: 160 },
  { key: "mccall-per-diem", label: "McCall Per Diem", abbreviation: "McCall Per diem", sortOrder: 170 },
  { key: "mie-first-last-day", label: "MI&E First/Last Day", abbreviation: "MI&E first/last day", sortOrder: 180 },
  { key: "mie-full-day", label: "MI&E Full Day", abbreviation: "MI&E full day", sortOrder: 190 },
];

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
      await tx.insert(visitTypesTable).values(missing);
    }
  });
  seededVisitTypes = true;
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
  };
}
