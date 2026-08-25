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

  it("carries the billed amount per line and sums it into subtotals + grand total", () => {
    // The route resolves each entry's billed dollars (visit + mileage, hourly,
    // etc.) exactly as the invoice does; the builder just carries and sums them.
    const { employees, totals } = buildReconciliationReport([
      entry({ id: 1, date: "2026-07-01", visitType: "skilled-nursing", amount: 268 }),
      entry({ id: 2, date: "2026-07-02", visitType: "skilled-nursing", mileage: 10, amount: 275.25 }),
      entry({
        id: 3, date: "2026-07-03",
        employeeId: "e2", employeeName: "Zoe Adams", employeeRole: "RN",
        hours: 4, amount: 200,
      }),
    ]);
    // Sorted by name: Jane Smith (e1) then Zoe Adams (e2).
    expect(employees[0].lines.map((l) => l.amount)).toEqual([268, 275.25]);
    expect(employees[0].totalAmount).toBe(543.25); // 268 + 275.25
    expect(employees[1].lines.map((l) => l.amount)).toEqual([200]);
    expect(employees[1].totalAmount).toBe(200);
    // Grand total is the sum of every billed line — the invoice-reconciling figure.
    expect(totals.totalAmount).toBe(743.25); // 543.25 + 200
  });

  it("defaults the billed amount to 0 when the route supplies none", () => {
    const { employees, totals } = buildReconciliationReport([
      entry({ id: 1, date: "2026-07-01", visitType: "skilled-nursing" }),
    ]);
    expect(employees[0].lines[0].amount).toBe(0);
    expect(employees[0].totalAmount).toBe(0);
    expect(totals.totalAmount).toBe(0);
  });

  it("accumulates billed amounts in full precision, rounding subtotals/total once", () => {
    // Mileage billed at $0.725/mi (Molly's rate): 15 mi = $10.875 per line.
    // Rounding each line then summing would give 3 x 10.88 = 32.64; the builder
    // sums in full precision (32.625) and rounds once, matching how the invoice
    // totals an aggregated bucket.
    const entries = Array.from({ length: 3 }, (_, i) =>
      entry({ id: i + 1, date: `2026-07-0${i + 1}`, mileage: 15, amount: 10.875 }),
    );
    const { employees, totals } = buildReconciliationReport(entries);
    expect(employees[0].lines.map((l) => l.amount)).toEqual([10.88, 10.88, 10.88]);
    expect(employees[0].totalAmount).toBe(32.63);
    expect(totals.totalAmount).toBe(32.63);
  });

  it("grand-totals billed dollars from rounded employee subtotals (matches the invoice)", () => {
    // Two employees each billed 15 mi x $0.725 = $10.875. The invoice rounds
    // each employee's mileage bucket to $10.88 and sums them to $21.76. Summing
    // the rounded subtotals here reproduces that exactly, whereas one global
    // full-precision sum (round2(21.75) = 21.75) would land a penny low.
    const { employees, totals } = buildReconciliationReport([
      entry({ id: 1, date: "2026-07-01", mileage: 15, amount: 10.875 }),
      entry({
        id: 2, date: "2026-07-02",
        employeeId: "e2", employeeName: "Zoe Adams", employeeRole: "RN",
        mileage: 15, amount: 10.875,
      }),
    ]);
    expect(employees.map((e) => e.totalAmount)).toEqual([10.88, 10.88]);
    expect(totals.totalAmount).toBe(21.76);
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
      totalAmount: 0,
    });
  });
});
