import { eq, and } from "drizzle-orm";
import {
  db,
  clientRatesTable,
  employeeRatesTable,
  type ClientRateRow,
  type EmployeeRateRow,
} from "@workspace/db";

// Rates are stored as append-only history rows. These helpers resolve the
// rate that was in effect on a given date (YYYY-MM-DD): the row with the
// latest effectiveDate <= entryDate. If every row is dated after the entry
// (e.g. seed data added late), the earliest known rate is used so math never
// silently returns nothing.
function pickForDate<T extends { effectiveDate: string; id: number }>(
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
