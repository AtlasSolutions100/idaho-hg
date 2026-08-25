import { eq, and } from "drizzle-orm";
import {
  db,
  clientRatesTable,
  clientPayRatesTable,
  employeeRatesTable,
  visitPayRatesTable,
  type ClientRateRow,
  type ClientPayRateRow,
  type EmployeeRateRow,
  type VisitPayRateRow,
} from "@workspace/db";

// Rates are stored as append-only history rows. These helpers resolve the
// rate that was in effect on a given date (YYYY-MM-DD): the row with the
// latest effectiveDate <= entryDate. If every row is dated after the entry
// (e.g. seed data added late), the earliest known rate is used so math never
// silently returns nothing.
export function pickForDate<T extends { effectiveDate: string; id: number }>(
  rows: T[],
  entryDate: string,
): T | undefined {
  if (rows.length === 0) return undefined;
  const applicable = rows.filter((row) => row.effectiveDate <= entryDate);
  const pool = applicable.length > 0 ? applicable : rows;
  const pickLatest = applicable.length > 0;
  return pool.reduce((best, row) => {
    const cmp =
      row.effectiveDate === best.effectiveDate
        ? row.id - best.id
        : row.effectiveDate < best.effectiveDate
          ? -1
          : 1;
    if (pickLatest ? cmp > 0 : cmp < 0) return row;
    return best;
  });
}

/** Client billing rate in effect on `entryDate` for a client + visit type. */
export async function getClientRateForDate(
  clientId: string,
  visitType: string,
  entryDate: string,
): Promise<ClientRateRow | undefined> {
  const rows = await db
    .select()
    .from(clientRatesTable)
    .where(
      and(eq(clientRatesTable.clientId, clientId), eq(clientRatesTable.visitType, visitType)),
    );
  return pickForDate(rows, entryDate);
}

/** Client PAY rate (per-client hourly pay) in effect on `entryDate`. */
export async function getClientPayRateForDate(
  clientId: string,
  visitType: string,
  entryDate: string,
): Promise<ClientPayRateRow | undefined> {
  const rows = await db
    .select()
    .from(clientPayRatesTable)
    .where(
      and(
        eq(clientPayRatesTable.clientId, clientId),
        eq(clientPayRatesTable.visitType, visitType),
      ),
    );
  return pickForDate(rows, entryDate);
}

/** The weekend/holiday multiplier for a day (1 when neither; the higher when both). */
export function pickDayMultiplier(
  isWeekend: boolean,
  isHoliday: boolean,
  weekendMult: number,
  holidayMult: number,
): number {
  if (isWeekend && isHoliday) return Math.max(weekendMult, holidayMult);
  if (isWeekend) return weekendMult;
  if (isHoliday) return holidayMult;
  return 1;
}

export type ResolvedRate = { rate: number; multiplier: number };

/**
 * Resolve an effective rate for a day, trying candidate base keys in order.
 * An explicit day-type variant ("{key}-weekend"/"-holiday") wins and is used
 * as-is (multiplier 1) — this is how a client like Weiser encodes distinct
 * weekend rates. Otherwise the first base key found is returned with the
 * per-client day multiplier (how St. Luke's encodes its flat +10%). Returns
 * undefined when no candidate key has a rate.
 */
export async function resolveDayTypeRate(
  lookup: (key: string) => Promise<{ rate: number } | undefined>,
  keys: string[],
  isWeekend: boolean,
  isHoliday: boolean,
  weekendMult: number,
  holidayMult: number,
): Promise<ResolvedRate | undefined> {
  const suffix = isHoliday ? "holiday" : isWeekend ? "weekend" : null;
  if (suffix) {
    for (const k of keys) {
      const variant = await lookup(`${k}-${suffix}`);
      if (variant) return { rate: variant.rate, multiplier: 1 };
    }
  }
  for (const k of keys) {
    const base = await lookup(k);
    if (base) {
      return {
        rate: base.rate,
        multiplier: pickDayMultiplier(isWeekend, isHoliday, weekendMult, holidayMult),
      };
    }
  }
  return undefined;
}

/** Employee pay rates in effect on `entryDate` for an employee. */
export async function getEmployeeRateForDate(
  employeeId: string,
  entryDate: string,
): Promise<EmployeeRateRow | undefined> {
  const rows = await db
    .select()
    .from(employeeRatesTable)
    .where(eq(employeeRatesTable.employeeId, employeeId));
  return pickForDate(rows, entryDate);
}

/**
 * Per-discipline employee PAY rate for a visit type, in effect on `entryDate`.
 * This is the visit-type-specific pay (e.g. RN start-of-care = $268) that
 * replaces the single flat employee_rates.visitRate for visit-based pay.
 * Returns undefined when Molly hasn't set a rate for this (discipline, visit
 * type) yet — callers fall back to employee_rates.visitRate.
 */
export async function getVisitPayRateForDate(
  discipline: string,
  visitType: string,
  entryDate: string,
): Promise<VisitPayRateRow | undefined> {
  const rows = await db
    .select()
    .from(visitPayRatesTable)
    .where(
      and(
        eq(visitPayRatesTable.discipline, discipline),
        eq(visitPayRatesTable.visitType, visitType),
      ),
    );
  return pickForDate(rows, entryDate);
}
