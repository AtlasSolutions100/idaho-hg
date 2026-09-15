import { describe, expect, it } from "vitest";
import type { EmployeeRateRow } from "@workspace/db";
import { mileageCorrections } from "./staff-mileage";

let nextId = 1;
const rateRow = (overrides: Partial<EmployeeRateRow> = {}): EmployeeRateRow => ({
  id: nextId++,
  employeeId: "adrian",
  employeeName: "Adrian Eddins",
  employeeRole: "RN",
  hourlyRate: 45,
  visitRate: 70,
  mileageRate: 0.69,
  perDiemRate: 45,
  weekendMultiplier: 1.5,
  holidayMultiplier: 2,
  effectiveDate: "2024-01-01",
  ...overrides,
});

// First day of the pay period open on 2026-09-15 (see payPeriodContaining).
const OPEN_PERIOD = "2026-09-06";

describe("mileageCorrections", () => {
  it("moves an employee still on $0.69 to $0.65 from the open pay period", () => {
    const corrections = mileageCorrections([rateRow()], OPEN_PERIOD);
    expect(corrections).toHaveLength(1);
    expect(corrections[0]).toMatchObject({
      employeeId: "adrian",
      mileageRate: 0.65,
      effectiveDate: OPEN_PERIOD,
      hourlyRate: 45,
      perDiemRate: 45,
    });
    // A new history row, not an edit to the one a past period was paid at.
    expect(corrections[0]).not.toHaveProperty("id");
  });

  it("carries forward the rate in effect, not the oldest one", () => {
    const corrections = mileageCorrections(
      [
        rateRow({ hourlyRate: 45, mileageRate: 0.69, effectiveDate: "2024-01-01" }),
        rateRow({ hourlyRate: 52, mileageRate: 0.655, effectiveDate: "2025-03-01" }),
      ],
      OPEN_PERIOD,
    );
    expect(corrections).toHaveLength(1);
    expect(corrections[0]).toMatchObject({ hourlyRate: 52, mileageRate: 0.65 });
  });

  it("leaves an employee already on $0.65 alone, as Postgres reads it back too", () => {
    expect(mileageCorrections([rateRow({ mileageRate: 0.65 })], OPEN_PERIOD)).toEqual([]);
    expect(
      mileageCorrections([rateRow({ mileageRate: 0.6499999761581421 })], OPEN_PERIOD),
    ).toEqual([]);
  });

  it("doesn't override a rate change Molly already scheduled", () => {
    const scheduled = [
      rateRow(),
      rateRow({ mileageRate: 0.7, effectiveDate: "2026-10-04" }),
    ];
    expect(mileageCorrections(scheduled, OPEN_PERIOD)).toEqual([]);
  });

  it("decides each employee on their own history", () => {
    const corrections = mileageCorrections(
      [
        rateRow({ employeeId: "adrian" }),
        rateRow({ employeeId: "paige", employeeName: "Paige Barbero", mileageRate: 0.65 }),
        rateRow({ employeeId: "ronda", employeeName: "Ronda Stewart", mileageRate: 0.655 }),
      ],
      OPEN_PERIOD,
    );
    expect(corrections.map((c) => c.employeeId).sort()).toEqual(["adrian", "ronda"]);
  });
});
