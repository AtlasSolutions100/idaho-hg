// Pure reconciliation report builder, extracted so it can be unit tested
// without a database (same pattern as invoice-lines.ts).
//
// One employee section per employee (sorted by name), daily rows sorted by
// date, plus per-employee subtotals: visit counts by type (the St. Luke's
// visit-quantity view), hours (the Weiser hours view), mileage and per diem.
// Notes are always carried through — they're the point of this report.

import { round2 } from "./payroll-calc";

export type ReconciliationEntryInput = {
  id: number | string;
  date: string; // YYYY-MM-DD
  employeeId: string;
  employeeName: string;
  employeeRole: string;
  visitType: string | null;
  /** How many of the visit type (or billable blocks); 1 when absent. */
  quantity?: number | null;
  hours: number | null;
  /** Last day covered when the entry spans a range (mileage over a period). */
  endDate?: string | null;
  mileage: number | null;
  perDiem: number | null;
  isWeekend: boolean;
  isHoliday: boolean;
  note: string | null;
  /** One-off "Other" work (training, meetings) — the note says what it was. */
  isOther?: boolean;
  /**
   * Total dollar amount this entry bills the CLIENT — the sum of its billed
   * components (visit or hourly + mileage + per-diem, or an Other flat amount).
   * Resolved by the route with the SAME rate helpers the invoice uses (see
   * routes/reports.ts), so the reconciliation dollars reconcile to the invoice.
   * Full precision; the builder rounds the per-line/subtotal/total figures.
   */
  amount?: number;
};

export type ReconciliationLine = {
  entryId: string;
  date: string;
  visitType?: string;
  /** Only present when more than one of the visit type is covered. */
  quantity?: number;
  endDate?: string;
  hours?: number;
  mileage?: number;
  perDiem?: number;
  isWeekend: boolean;
  isHoliday: boolean;
  note: string;
  isOther?: boolean;
  /** Dollar amount billed to the client for this line (rounded to cents). */
  amount: number;
};

export type VisitTypeCount = { visitType: string; count: number };

export type ReconciliationEmployeeGroup = {
  employeeId: string;
  employeeName: string;
  employeeRole: string;
  lines: ReconciliationLine[];
  visitCounts: VisitTypeCount[];
  totalVisits: number;
  totalHours: number;
  totalMileage: number;
  totalPerDiem: number;
  /** Sum of this employee's billed line amounts, rounded to cents. */
  totalAmount: number;
};

export type ReconciliationTotals = {
  visitCounts: VisitTypeCount[];
  totalVisits: number;
  totalHours: number;
  totalMileage: number;
  totalPerDiem: number;
  /** Report-wide billed total, rounded to cents — must equal the invoice total. */
  totalAmount: number;
};

export type ReconciliationResult = {
  employees: ReconciliationEmployeeGroup[];
  totals: ReconciliationTotals;
};

function countsFrom(map: Map<string, number>): VisitTypeCount[] {
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([visitType, count]) => ({ visitType, count }));
}

export function buildReconciliationReport(
  entries: ReconciliationEntryInput[],
): ReconciliationResult {
  const groups = new Map<string, ReconciliationEmployeeGroup & { visitMap: Map<string, number> }>();
  const reportVisitMap = new Map<string, number>();
  let totalVisits = 0;
  let totalHours = 0;
  let totalMileage = 0;
  let totalPerDiem = 0;

  for (const entry of entries) {
    let group = groups.get(entry.employeeId);
    if (!group) {
      group = {
        employeeId: entry.employeeId,
        employeeName: entry.employeeName,
        employeeRole: entry.employeeRole,
        lines: [],
        visitCounts: [],
        totalVisits: 0,
        totalHours: 0,
        totalMileage: 0,
        totalPerDiem: 0,
        totalAmount: 0,
        visitMap: new Map(),
      };
      groups.set(entry.employeeId, group);
    }
    group.lines.push({
      entryId: String(entry.id),
      date: entry.date,
      ...(entry.endDate ? { endDate: entry.endDate } : {}),
      ...(entry.visitType ? { visitType: entry.visitType } : {}),
      ...(entry.visitType && entry.quantity != null && entry.quantity !== 1
        ? { quantity: entry.quantity }
        : {}),
      ...(entry.hours != null ? { hours: entry.hours } : {}),
      ...(entry.mileage != null ? { mileage: entry.mileage } : {}),
      ...(entry.perDiem != null ? { perDiem: entry.perDiem } : {}),
      ...(entry.isOther ? { isOther: true } : {}),
      isWeekend: entry.isWeekend,
      isHoliday: entry.isHoliday,
      note: entry.note ?? "",
      // Billed dollars for this line — the reconciliation view of what the
      // invoice charges for this entry. Rounded for display; subtotals and the
      // grand total accumulate in full precision below and round once.
      amount: round2(entry.amount ?? 0),
    });
    if (entry.visitType) {
      // Count how many the entry covers, not how many rows there are — two
      // evals logged as one entry are two visits on the invoice, so they have
      // to be two here too or the reconciliation would not reconcile.
      const count = entry.quantity != null && entry.quantity > 0 ? entry.quantity : 1;
      group.visitMap.set(entry.visitType, (group.visitMap.get(entry.visitType) ?? 0) + count);
      reportVisitMap.set(entry.visitType, (reportVisitMap.get(entry.visitType) ?? 0) + count);
      group.totalVisits += count;
      totalVisits += count;
    }
    // Accumulate in full precision; rounding happens once at the end so
    // fractional hours/miles can't drift the totals.
    if (entry.hours != null) {
      group.totalHours += entry.hours;
      totalHours += entry.hours;
    }
    if (entry.mileage != null) {
      group.totalMileage += entry.mileage;
      totalMileage += entry.mileage;
    }
    if (entry.perDiem != null) {
      group.totalPerDiem += entry.perDiem;
      totalPerDiem += entry.perDiem;
    }
    // Per-employee billed dollars accumulate in full precision; each employee
    // subtotal rounds once (below), then the grand total sums those rounded
    // subtotals — see the totals block for why this reconciles to the invoice.
    if (entry.amount != null) {
      group.totalAmount += entry.amount;
    }
  }

  const employees = [...groups.values()]
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName))
    .map(({ visitMap, ...group }) => ({
      ...group,
      totalHours: round2(group.totalHours),
      totalMileage: round2(group.totalMileage),
      totalPerDiem: round2(group.totalPerDiem),
      totalAmount: round2(group.totalAmount),
      lines: [...group.lines].sort(
        (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : Number(a.entryId) - Number(b.entryId)),
      ),
      visitCounts: countsFrom(visitMap),
    }));

  return {
    employees,
    totals: {
      visitCounts: countsFrom(reportVisitMap),
      totalVisits,
      totalHours: round2(totalHours),
      totalMileage: round2(totalMileage),
      totalPerDiem: round2(totalPerDiem),
      // Grand billed total = the sum of the per-employee (already rounded)
      // subtotals — the same aggregation the payroll grandTotal and the invoice
      // total use. The invoice rounds each employee's billed bucket and sums
      // those, so summing rounded subtotals here reconciles to the invoice to
      // the penny even for sub-cent rates (e.g. mileage at $0.725/mi spread
      // across several employees), where a single full-precision global sum
      // could land a cent off.
      totalAmount: round2(employees.reduce((sum, e) => sum + e.totalAmount, 0)),
    },
  };
}
