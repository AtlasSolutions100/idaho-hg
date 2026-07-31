import { describe, it, expect } from "vitest";
import {
  buildReconciliationReport,
  type ReconciliationEntryInput,
} from "./reconciliation-lines";

const base = {
  employeeId: "e1",
  employeeName: "Jane Smith",
  employeeRole: "PT",
  visitType: null as string | null,
  hours: null as number | null,
  mileage: null as number | null,
  perDiem: null as number | null,
  isWeekend: false,
  isHoliday: false,
  note: null as string | null,
};

function entry(
  overrides: Partial<ReconciliationEntryInput> & { id: number; date: string },
): ReconciliationEntryInput {
  return { ...base, ...overrides };
}

describe("buildReconciliationReport", () => {
  it("groups by employee sorted by name, lines sorted by date", () => {
    const { employees } = buildReconciliationReport([
      entry({ id: 1, date: "2026-07-20", employeeId: "e2", employeeName: "Zoe Adams", employeeRole: "RN", visitType: "skilled-nursing" }),
      entry({ id: 2, date: "2026-07-15", hours: 4 }),
      entry({ id: 3, date: "2026-07-10", hours: 3 }),
    ]);
    expect(employees.map((e) => e.employeeName)).toEqual(["Jane Smith", "Zoe Adams"]);
    expect(employees[0].lines.map((l) => l.date)).toEqual(["2026-07-10", "2026-07-15"]);
  });

  it("counts visits per type for the St. Luke's style view", () => {
    const { employees, totals } = buildReconciliationReport([
      entry({ id: 1, date: "2026-07-01", visitType: "skilled-nursing" }),
      entry({ id: 2, date: "2026-07-02", visitType: "skilled-nursing" }),
      entry({ id: 3, date: "2026-07-03", visitType: "physical-therapy" }),
    ]);
    expect(employees[0].visitCounts).toEqual([
      { visitType: "physical-therapy", count: 1 },
      { visitType: "skilled-nursing", count: 2 },
    ]);
    expect(employees[0].totalVisits).toBe(3);
    expect(totals.totalVisits).toBe(3);
    expect(totals.visitCounts).toEqual(employees[0].visitCounts);
  });

  it("subtotals hours, mileage and per diem per employee and report-wide", () => {
    const { employees, totals } = buildReconciliationReport([
      entry({ id: 1, date: "2026-07-01", hours: 4.5, mileage: 12.3 }),
      entry({ id: 2, date: "2026-07-02", hours: 3.1, perDiem: 1 }),
      entry({ id: 3, date: "2026-07-03", employeeId: "e2", employeeName: "Zoe Adams", employeeRole: "RN", mileage: 10, perDiem: 2 }),
    ]);
    expect(employees[0]).toMatchObject({ totalHours: 7.6, totalMileage: 12.3, totalPerDiem: 1 });
    expect(employees[1]).toMatchObject({ totalHours: 0, totalMileage: 10, totalPerDiem: 2 });
    expect(totals).toMatchObject({ totalHours: 7.6, totalMileage: 22.3, totalPerDiem: 3 });
  });

  it("always carries notes through, empty when missing", () => {
    const { employees } = buildReconciliationReport([
      entry({ id: 1, date: "2026-07-01", visitType: "skilled-nursing", note: "Block H@H" }),
      entry({ id: 2, date: "2026-07-02", hours: 2 }),
    ]);
    expect(employees[0].lines[0].note).toBe("Block H@H");
    expect(employees[0].lines[1].note).toBe("");
  });

  it("keeps weekend/holiday flags and mileage/per diem on each line", () => {
    const { employees } = buildReconciliationReport([
      entry({ id: 1, date: "2026-07-04", visitType: "skilled-nursing", mileage: 30, perDiem: 1, isWeekend: true, isHoliday: true }),
    ]);
    expect(employees[0].lines[0]).toMatchObject({
      visitType: "skilled-nursing",
      mileage: 30,
      perDiem: 1,
      isWeekend: true,
      isHoliday: true,
    });
  });

  it("sums fractional values in full precision, rounding only at the end", () => {
    // 0.1 added ten times drifts with per-step rounding of binary floats
    const entries = Array.from({ length: 10 }, (_, i) =>
      entry({ id: i + 1, date: `2026-07-0${(i % 9) + 1}`, hours: 0.1, mileage: 1.005 }),
    );
    const { employees, totals } = buildReconciliationReport(entries);
    expect(employees[0].totalHours).toBe(1);
    expect(totals.totalHours).toBe(1);
    expect(employees[0].totalMileage).toBe(10.05);
    expect(totals.totalMileage).toBe(10.05);
  });

  it("returns empty structures for no entries", () => {
    const { employees, totals } = buildReconciliationReport([]);
    expect(employees).toEqual([]);
    expect(totals).toEqual({
      visitCounts: [],
      totalVisits: 0,
      totalHours: 0,
      totalMileage: 0,
      totalPerDiem: 0,
    });
  });
});
