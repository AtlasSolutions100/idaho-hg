import { describe, it, expect, afterAll } from "vitest";
import { inArray } from "drizzle-orm";
import {
  db,
  pool,
  employeesTable,
  employeeRatesTable,
  timeEntriesTable,
  onboardingItemsTable,
} from "@workspace/db";
import {
  DEMO_EMPLOYEE_IDS,
  hasDemoEmployeeData,
  purgeDemoEmployeeData,
} from "./demo-cleanup";

async function cleanup() {
  await db
    .delete(onboardingItemsTable)
    .where(inArray(onboardingItemsTable.employeeId, DEMO_EMPLOYEE_IDS));
  await db
    .delete(timeEntriesTable)
    .where(inArray(timeEntriesTable.employeeId, DEMO_EMPLOYEE_IDS));
  await db
    .delete(employeeRatesTable)
    .where(inArray(employeeRatesTable.employeeId, DEMO_EMPLOYEE_IDS));
  await db
    .delete(employeesTable)
    .where(inArray(employeesTable.id, DEMO_EMPLOYEE_IDS));
}

afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("demo employee cleanup", () => {
  it("reports no demo data on a clean database", async () => {
    await cleanup();
    expect(await hasDemoEmployeeData()).toBe(false);
  });

  it("detects and purges demo employees plus all data keyed to them", async () => {
    await cleanup();
    await db
      .insert(employeesTable)
      .values({ id: "1", name: "Sarah Martinez", role: "RN", active: false });
    await db.insert(employeeRatesTable).values({
      employeeId: "1",
      employeeName: "Sarah Martinez",
      employeeRole: "RN",
      hourlyRate: 48,
      visitRate: 75,
      mileageRate: 0.655,
      perDiemRate: 45,
      weekendMultiplier: 1.5,
      holidayMultiplier: 2,
      effectiveDate: "2024-01-01",
    });
    await db.insert(timeEntriesTable).values({
      employeeId: "1",
      employeeName: "Sarah Martinez",
      employeeRole: "RN",
      clientId: "1",
      clientName: "St. Luke's Health System",
      date: "2024-02-01",
      hours: 4,
    });
    await db.insert(onboardingItemsTable).values({
      employeeId: "1",
      itemKey: "w4",
      completed: false,
    });

    expect(await hasDemoEmployeeData()).toBe(true);
    await purgeDemoEmployeeData();
    expect(await hasDemoEmployeeData()).toBe(false);

    const employees = await db
      .select()
      .from(employeesTable)
      .where(inArray(employeesTable.id, DEMO_EMPLOYEE_IDS));
    expect(employees).toHaveLength(0);
  });

  it("detects orphaned demo rows even when no demo employees exist", async () => {
    await cleanup();
    // No FK constraints: time entries / onboarding rows can survive after
    // the demo employees themselves were deleted (e.g. partial restore).
    await db.insert(timeEntriesTable).values({
      employeeId: "3",
      employeeName: "Emily Rodriguez",
      employeeRole: "PT",
      clientId: "2",
      clientName: "Weiser Memorial Hospital",
      date: "2024-03-01",
      hours: 2,
    });
    await db.insert(onboardingItemsTable).values({
      employeeId: "5",
      itemKey: "i9",
      completed: true,
    });

    expect(await hasDemoEmployeeData()).toBe(true);
    await purgeDemoEmployeeData();
    expect(await hasDemoEmployeeData()).toBe(false);
  });
});
