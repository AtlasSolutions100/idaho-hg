import { inArray } from "drizzle-orm";
import {
  db,
  employeesTable,
  employeeRatesTable,
  timeEntriesTable,
  onboardingItemsTable,
} from "@workspace/db";

// The original demo roster used numeric string IDs "1"–"6" (Sarah Martinez,
// James Chen, Emily Rodriguez, Michael Thompson, Jessica Park, David
// Williams). Real employees use UUIDs. If a restored backup or old seed ever
// reintroduces these rows, they must be permanently removed along with any
// data keyed to them so ghost entries never resurface in reports or payroll.
export const DEMO_EMPLOYEE_IDS = ["1", "2", "3", "4", "5", "6"];

/**
 * Returns true if any demo employee rows (or data keyed to them) exist in
 * any table: employees, employee_rates, time_entries, or onboarding_items.
 * There are no FK constraints, so orphaned demo rows can exist even when
 * the demo employees themselves are gone.
 */
export async function hasDemoEmployeeData(): Promise<boolean> {
  const [employee] = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(inArray(employeesTable.id, DEMO_EMPLOYEE_IDS))
    .limit(1);
  if (employee) return true;
  const [rate] = await db
    .select({ id: employeeRatesTable.id })
    .from(employeeRatesTable)
    .where(inArray(employeeRatesTable.employeeId, DEMO_EMPLOYEE_IDS))
    .limit(1);
  if (rate) return true;
  const [timeEntry] = await db
    .select({ id: timeEntriesTable.id })
    .from(timeEntriesTable)
    .where(inArray(timeEntriesTable.employeeId, DEMO_EMPLOYEE_IDS))
    .limit(1);
  if (timeEntry) return true;
  const [onboarding] = await db
    .select({ id: onboardingItemsTable.id })
    .from(onboardingItemsTable)
    .where(inArray(onboardingItemsTable.employeeId, DEMO_EMPLOYEE_IDS))
    .limit(1);
  return Boolean(onboarding);
}

/**
 * Permanently deletes the demo employees (IDs "1"–"6") and every row keyed
 * to them: pay rates, time entries, and onboarding checklist items.
 * Idempotent — safe to run on every startup and before seeding.
 */
export async function purgeDemoEmployeeData(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(onboardingItemsTable)
      .where(inArray(onboardingItemsTable.employeeId, DEMO_EMPLOYEE_IDS));
    await tx
      .delete(timeEntriesTable)
      .where(inArray(timeEntriesTable.employeeId, DEMO_EMPLOYEE_IDS));
    await tx
      .delete(employeeRatesTable)
      .where(inArray(employeeRatesTable.employeeId, DEMO_EMPLOYEE_IDS));
    await tx
      .delete(employeesTable)
      .where(inArray(employeesTable.id, DEMO_EMPLOYEE_IDS));
  });
}
