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
  hours: number | null;
  mileage: number | null;
  perDiem: number | null;
  isWeekend: boolean;
  isHoliday: boolean;
  note: string | null;
};

export type ReconciliationLine = {
  entryId: string;
  date: string;
  visitType?: string;
  hours?: number;
  mileage?: number;
  perDiem?: number;
  isWeekend: boolean;
  isHoliday: boolean;
  note: string;
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
};

export type ReconciliationTotals = {
  visitCounts: VisitTypeCount[];
  totalVisits: number;
  totalHours: number;
  totalMileage: number;
  totalPerDiem: number;
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
        visitMap: new Map(),
      };
      groups.set(entry.employeeId, group);
    }
    group.lines.push({
      entryId: String(entry.id),
      date: entry.date,
      ...(entry.visitType ? { visitType: entry.visitType } : {}),
      ...(entry.hours != null ? { hours: entry.hours } : {}),
      ...(entry.mileage != null ? { mileage: entry.mileage } : {}),
      ...(entry.perDiem != null ? { perDiem: entry.perDiem } : {}),
      isWeekend: entry.isWeekend,
      isHoliday: entry.isHoliday,
      note: entry.note ?? "",
    });
    if (entry.visitType) {
      group.visitMap.set(entry.visitType, (group.visitMap.get(entry.visitType) ?? 0) + 1);
      reportVisitMap.set(entry.visitType, (reportVisitMap.get(entry.visitType) ?? 0) + 1);
      group.totalVisits += 1;
      totalVisits += 1;
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
  }

  const employees = [...groups.values()]
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName))
    .map(({ visitMap, ...group }) => ({
      ...group,
      totalHours: round2(group.totalHours),
      totalMileage: round2(group.totalMileage),
      totalPerDiem: round2(group.totalPerDiem),
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
    },
  };
}
