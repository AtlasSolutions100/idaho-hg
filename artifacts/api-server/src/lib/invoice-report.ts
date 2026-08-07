// Shared invoice-report computation, used by both the GET /reports/invoice
// route and POST /qbo/invoice (Send to QuickBooks). Keeping this in one place
// guarantees the invoice pushed into QuickBooks has exactly the same lines,
// quantities, rates, and amounts as the report/CSV/PDF Molly sees.

import { eq, and, gte, lte, asc } from "drizzle-orm";
import { db, timeEntriesTable, clientsTable, type TimeEntryRow } from "@workspace/db";
import { getClientRateForDate, getEmployeeRateForDate } from "./rate-lookup";
import { buildInvoiceLines, type InvoiceEntryInput, type InvoiceLine } from "./invoice-lines";

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
  const annotated: InvoiceEntryInput[] = [];
  for (const entry of entries) {
    const input: InvoiceEntryInput = {
      id: entry.id,
      date: entry.date,
      employeeId: entry.employeeId,
      employeeName: entry.employeeName,
      employeeRole: entry.employeeRole,
      visitType: entry.visitType,
      hours: entry.hours,
      mileage: entry.mileage,
      perDiem: entry.perDiem,
    };
    if (entry.visitType) {
      // Try role-specific visit rate first (e.g. "soc-RN"), fall back to the
      // generic visit type so clients with a single rate per visit type still work.
      const roleVisitRate = entry.employeeRole
        ? await getClientRateForDate(clientId, `${entry.visitType}-${entry.employeeRole}`, entry.date)
        : undefined;
      const rate = roleVisitRate ?? (await getClientRateForDate(clientId, entry.visitType, entry.date));
      if (rate) input.visitRate = rate.rate;
    } else if (entry.hours != null && entry.hours > 0) {
      // Try role-specific hourly rate first (e.g. "hourly-RN"), fall back to
      // the generic "hourly" rate so clients with a single hourly rate still work.
      const roleRate = entry.employeeRole
        ? await getClientRateForDate(clientId, `hourly-${entry.employeeRole}`, entry.date)
        : undefined;
      const rate = roleRate ?? (await getClientRateForDate(clientId, "hourly", entry.date));
      if (rate) input.hourlyRate = rate.rate;
    }
    if ((entry.mileage ?? 0) > 0 || (entry.perDiem ?? 0) > 0) {
      const empRate = await getEmployeeRateForDate(entry.employeeId, entry.date);
      if (empRate) {
        input.mileageRate = empRate.mileageRate;
        input.perDiemRate = empRate.perDiemRate;
      }
    }
    annotated.push(input);
  }

  const { lines, total, missingRateCount, unbilledCount } = buildInvoiceLines(annotated);

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
  };
}
