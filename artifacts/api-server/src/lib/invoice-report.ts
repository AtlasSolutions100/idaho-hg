// Shared invoice-report computation, used by both the GET /reports/invoice
// route and POST /qbo/invoice (Send to QuickBooks). Keeping this in one place
// guarantees the invoice pushed into QuickBooks has exactly the same lines,
// quantities, rates, and amounts as the report/CSV/PDF Molly sees.

import { eq, and, gte, lte, asc } from "drizzle-orm";
import { db, timeEntriesTable, clientsTable, type TimeEntryRow } from "@workspace/db";
import {
  getClientRateForDate,
  getEmployeeRateForDate,
  resolveDayTypeRate,
  pickDayMultiplier,
} from "./rate-lookup";
import { buildInvoiceLines, type InvoiceEntryInput, type InvoiceLine } from "./invoice-lines";
import { visitTypeUnitMap } from "./visit-types";
import { daysWithDriveTimeWork, unbillableReason } from "./drive-time";
import { billableHours, hourlyRateKeys, normalizeHourKind } from "./hour-kinds";

export type InvoiceReportData = {
  clientId: string;
  clientName: string;
  start: string;
  end: string;
  lines: InvoiceLine[];
  total: number;
  entryCount: number;
  missingRateCount: number;
  unbilledCount: number;
  /** Optional per-client footer note shown on the PDF invoice. */
  noteToCustomer?: string;
};

async function approvedEntriesInRange(start: string, end: string): Promise<TimeEntryRow[]> {
  return db
    .select()
    .from(timeEntriesTable)
    .where(
      and(
        eq(timeEntriesTable.status, "approved"),
        gte(timeEntriesTable.date, start),
        lte(timeEntriesTable.date, end),
      ),
    )
    .orderBy(asc(timeEntriesTable.date), asc(timeEntriesTable.id));
}

/** Returns null when the client does not exist. */
export async function computeInvoiceReport(
  clientId: string,
  start: string,
  end: string,
): Promise<InvoiceReportData | null> {
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
  if (!client) return null;

  const entries = (await approvedEntriesInRange(start, end)).filter(
    (e) => e.clientId === clientId,
  );

  // Annotate each approved entry with the rates in effect on its date:
  // - visit entries bill the client's per-visit rate for that visit type
  // - hourly entries bill the client's "hourly" billing rate
  // - mileage and per diem are passed through at the employee's
  //   reimbursement rates in effect on the entry date
  // Missing rates produce $0 lines flagged "No rate" — never dropped.
  // Drive time only bills alongside Hospital at Home or hospice work on the
  // same employee's day (see lib/drive-time.ts).
  const daysWithWork = daysWithDriveTimeWork(entries);

  const annotated: InvoiceEntryInput[] = [];
  for (const entry of entries) {
    const input: InvoiceEntryInput = {
      id: entry.id,
      date: entry.date,
      employeeId: entry.employeeId,
      employeeName: entry.employeeName,
      employeeRole: entry.employeeRole,
      visitType: entry.visitType,
      quantity: entry.quantity,
      endDate: entry.endDate,
      hours: entry.hours,
      mileage: entry.mileage,
      perDiem: entry.perDiem,
      ...(entry.isOther
        ? { isOther: true, customBillAmount: entry.customBillAmount, note: entry.note }
        : {}),
    };
    const refused = unbillableReason(entry, daysWithWork);
    if (refused) input.unbillableReason = refused;

    const kind = normalizeHourKind(entry.hourKind);
    if (kind !== "regular") input.hourKind = kind;
    // A call-back is charged for the contract minimum however short the visit
    // turned out to be, so the invoice carries the billable hours.
    if (input.hours != null) {
      input.hours = billableHours(input.hours, kind, client.callBackMinimumHours);
    }

    if (entry.isOther) {
      // One-offs bill only Molly's flat amount (already on the entry) —
      // no client rate, mileage, or per-diem lookups.
    } else if (refused) {
      // Leave the rate off entirely: the line shows the work at $0 with the
      // reason, rather than a rate that was never going to be charged.
    } else if (entry.visitType) {
      // Try role-specific visit rate first (e.g. "soc-RN"), fall back to the
      // generic visit type so clients with a single rate per visit type still work.
      const roleVisitRate = entry.employeeRole
        ? await getClientRateForDate(clientId, `${entry.visitType}-${entry.employeeRole}`, entry.date)
        : undefined;
      const rate = roleVisitRate ?? (await getClientRateForDate(clientId, entry.visitType, entry.date));
      if (rate) {
        // Apply the per-client weekend/holiday multiplier to billing too
        // (St. Luke's +10% applies to "both billing and payment").
        const mult = pickDayMultiplier(
          entry.isWeekend,
          entry.isHoliday,
          client.weekendMultiplier,
          client.holidayMultiplier,
        );
        input.visitRate = rate.rate * mult;
      }
    } else if (entry.hours != null && entry.hours > 0) {
      // Per-client hourly billing, honoring explicit "-weekend"/"-holiday" rate
      // rows (e.g. Weiser's distinct weekend rate) then the base rate × the
      // client day multiplier; role-specific ("hourly-RN") before generic.
      const resolved = await resolveDayTypeRate(
        (key) => getClientRateForDate(clientId, key, entry.date),
        hourlyRateKeys(kind, entry.employeeRole),
        entry.isWeekend,
        entry.isHoliday,
        client.weekendMultiplier,
        client.holidayMultiplier,
      );
      if (resolved) input.hourlyRate = resolved.rate * resolved.multiplier;
    }
    if (!entry.isOther && ((entry.mileage ?? 0) > 0 || (entry.perDiem ?? 0) > 0)) {
      const needsMileage = (entry.mileage ?? 0) > 0;
      const needsPerDiem = (entry.perDiem ?? 0) > 0;
      // Invoices bill mileage/per-diem at the CLIENT billing rate (e.g. $0.725/mi)
      // when Molly has set one — this is distinct from the employee reimbursement
      // rate used on payroll (e.g. $0.65/mi). Stored as client_rates rows keyed
      // "mileage" / "per-diem". Falls back to the employee rate where no client
      // billing rate is set, so existing invoices are unchanged until she sets one.
      const clientMileage = needsMileage
        ? await getClientRateForDate(clientId, "mileage", entry.date)
        : undefined;
      const clientPerDiem = needsPerDiem
        ? await getClientRateForDate(clientId, "per-diem", entry.date)
        : undefined;
      const needEmpFallback =
        (needsMileage && !clientMileage) || (needsPerDiem && !clientPerDiem);
      const empRate = needEmpFallback
        ? await getEmployeeRateForDate(entry.employeeId, entry.date)
        : undefined;
      if (needsMileage) {
        const rate = clientMileage?.rate ?? empRate?.mileageRate;
        if (rate != null) input.mileageRate = rate;
      }
      if (needsPerDiem) {
        const rate = clientPerDiem?.rate ?? empRate?.perDiemRate;
        if (rate != null) input.perDiemRate = rate;
      }
    }
    annotated.push(input);
  }

  // Hospital at Home and drive time bill by the hour, so the line builder
  // needs the catalog to turn their block counts into hours.
  const { lines, total, missingRateCount, unbilledCount } = buildInvoiceLines(
    annotated,
    await visitTypeUnitMap(),
  );

  return {
    clientId,
    clientName: client.name,
    start,
    end,
    lines,
    total,
    entryCount: entries.length,
    missingRateCount,
    unbilledCount,
    ...(client.noteToCustomer ? { noteToCustomer: client.noteToCustomer } : {}),
  };
}
