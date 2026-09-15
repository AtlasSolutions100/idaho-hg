// Moving staff onto the mileage rate Molly actually pays.
//
// The rate sheet said $0.69/mi, and that seeded every employee. Molly has
// since confirmed $0.69 was only what she paid herself and Adrian before she
// had staff — every employee is reimbursed $0.65. Employee rates are history,
// so the fix is a new row per employee from a chosen date, never an edit to
// the rate a past period was paid at.
import type { EmployeeRateRow } from "@workspace/db";
import { pickForDate } from "./rate-lookup";

/** What every employee is reimbursed per mile (Molly, 2026-09-15). */
export const STAFF_MILEAGE_RATE = 0.65;

/**
 * The rate rows to add so every employee is reimbursed `target` per mile from
 * `effectiveDate`. Each copies the employee's rate in effect on that date and
 * changes only the mileage, so their hourly, visit and per diem rates carry on
 * untouched.
 *
 * An employee is skipped when they are already on the target — compared with a
 * tolerance, because the column is single precision and 0.65 reads back as
 * 0.6499999761581421 — or when Molly has already scheduled a rate change on or
 * after the date, which is hers to have made.
 */
export function mileageCorrections(
  rows: EmployeeRateRow[],
  effectiveDate: string,
  target: number = STAFF_MILEAGE_RATE,
): Array<Omit<EmployeeRateRow, "id">> {
  const byEmployee = new Map<string, EmployeeRateRow[]>();
  for (const row of rows) {
    const history = byEmployee.get(row.employeeId);
    if (history) history.push(row);
    else byEmployee.set(row.employeeId, [row]);
  }

  const corrections: Array<Omit<EmployeeRateRow, "id">> = [];
  for (const history of byEmployee.values()) {
    if (history.some((r) => r.effectiveDate >= effectiveDate)) continue;
    const current = pickForDate(history, effectiveDate);
    if (!current || Math.abs(current.mileageRate - target) < 1e-6) continue;
    const { id: _id, ...carried } = current;
    corrections.push({ ...carried, mileageRate: target, effectiveDate });
  }
  return corrections;
}
