import { sql } from "drizzle-orm";
import { db, disciplinesTable, type DisciplineRow } from "@workspace/db";

// The disciplines already in use across Molly's rate sheet and roster. The
// `key` is what lands on employees.role, so it must match the rate keys
// exactly — visit_pay_rates.discipline ("RN", "PT") and the client rate rows
// keyed "hourly-{DISCIPLINE}" ("hourly-PTA", "hourly-LPN").
//
// Her master sheet groups two pairs on one line ("PTA/COTA", "LMSW/LCSW")
// because they bill the same; they are separate professions, so they are
// separate entries here and share a rate row.
export const SEED_DISCIPLINES: Array<{
  key: string;
  label: string;
  sortOrder: number;
}> = [
  { key: "RN", label: "RN — Registered Nurse", sortOrder: 10 },
  { key: "LPN", label: "LPN — Licensed Practical Nurse", sortOrder: 20 },
  { key: "PT", label: "PT — Physical Therapist", sortOrder: 30 },
  { key: "PTA", label: "PTA — Physical Therapist Assistant", sortOrder: 40 },
  { key: "OT", label: "OT — Occupational Therapist", sortOrder: 50 },
  { key: "COTA", label: "COTA — Certified OT Assistant", sortOrder: 60 },
  { key: "SLP", label: "SLP — Speech-Language Pathologist", sortOrder: 70 },
  { key: "LCSW", label: "LCSW — Licensed Clinical Social Worker", sortOrder: 80 },
  { key: "LMSW", label: "LMSW — Licensed Master Social Worker", sortOrder: 90 },
];

// Same advisory-lock pattern as the visit-type seed: insert-if-missing, so
// concurrent instances and tests can't double-insert.
const DISCIPLINES_SEED_LOCK_KEY = 727_301_634;

let seededDisciplines = false;

/** Populate the catalog on first use (idempotent). */
export async function ensureDisciplinesSeeded(): Promise<void> {
  if (seededDisciplines) return;
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${DISCIPLINES_SEED_LOCK_KEY})`);
    const existing = await tx.select().from(disciplinesTable);
    const have = new Set(existing.map((r) => r.key));
    const missing = SEED_DISCIPLINES.filter((d) => !have.has(d.key));
    if (missing.length > 0) {
      await tx.insert(disciplinesTable).values(missing);
    }
  });
  seededDisciplines = true;
}

/** Reset the in-process seed guard. Tests only. */
export function resetDisciplineSeedCache(): void {
  seededDisciplines = false;
}

/** All discipline rows in catalog order (sortOrder then label). */
export async function listDisciplineRows(): Promise<DisciplineRow[]> {
  await ensureDisciplinesSeeded();
  const rows = await db.select().from(disciplinesTable);
  return rows.sort(
    (a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label),
  );
}

/** Set of valid discipline keys (active + retired), for write validation. */
export async function getDisciplineKeySet(): Promise<Set<string>> {
  const rows = await listDisciplineRows();
  return new Set(rows.map((r) => r.key));
}

/**
 * "registered nurse" -> "REGISTERED-NURSE". Discipline keys are the rate-key
 * segment after "hourly-", so they are uppercased and stripped of anything
 * that would make a rate key ambiguous.
 */
export function normalizeDisciplineKey(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function serializeDiscipline(row: DisciplineRow) {
  return {
    key: row.key,
    label: row.label,
    active: row.active,
    sortOrder: row.sortOrder,
  };
}
