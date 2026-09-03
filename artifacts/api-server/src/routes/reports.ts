import { Router, type IRouter } from "express";
import { eq, and, gte, lte, asc } from "drizzle-orm";
import {
  db,
  timeEntriesTable,
  clientsTable,
  type TimeEntryRow,
} from "@workspace/db";
import {
  getClientRateForDate,
  getClientPayRateForDate,
  getEmployeeRateForDate,
  getVisitPayRateForDate,
  resolveDayTypeRate,
  pickDayMultiplier,
} from "../lib/rate-lookup";
import { computePayrollAmounts, quantityOf, round2 } from "../lib/payroll-calc";
import { computeInvoiceReport } from "../lib/invoice-report";
import {
  buildReconciliationReport,
  type ReconciliationEntryInput,
} from "../lib/reconciliation-lines";
import { requireAdmin } from "../lib/employee-auth";

const router: IRouter = Router();

// Payroll, invoice, and reconciliation reports expose company-wide pay and
// billing figures — every route in this file is Molly's (admin) only.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseRange(start: unknown, end: unknown): { start: string; end: string } | null {
  if (typeof start !== "string" || typeof end !== "string") return null;
  if (!DATE_RE.test(start) || !DATE_RE.test(end)) return null;
  if (start > end) return null;
  return { start, end };
}

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

/**
 * The total dollars this entry bills the CLIENT — the reconciliation view of
 * an entry's contribution to the invoice. It resolves the very same rates,
 * multipliers, and fallbacks as computeInvoiceReport (invoice-report.ts) and
 * sums the entry's components (visit or hourly + mileage + per-diem, or an
 * "Other" flat amount). Because every entry is priced identically to the
 * invoice and each amount is summed, the reconciliation grand total equals the
 * invoice total for the same client + period. Full precision; the pure builder
 * rounds the per-line, subtotal, and grand-total figures.
 */
async function resolveEntryBilledAmount(
  entry: TimeEntryRow,
  client: { id: string; weekendMultiplier: number; holidayMultiplier: number },
): Promise<number> {
  // "Other" one-offs bill only Molly's flat amount (already on the entry) —
  // no rate, mileage, or per-diem lookups — mirroring the invoice.
  if (entry.isOther) {
    return entry.customBillAmount != null && entry.customBillAmount > 0
      ? entry.customBillAmount
      : 0;
  }

  let amount = 0;
  if (entry.visitType) {
    // Role-specific visit rate first (e.g. "soc-RN"), then the generic type.
    const roleVisitRate = entry.employeeRole
      ? await getClientRateForDate(client.id, `${entry.visitType}-${entry.employeeRole}`, entry.date)
      : undefined;
    const rate =
      roleVisitRate ?? (await getClientRateForDate(client.id, entry.visitType, entry.date));
    if (rate) {
      const mult = pickDayMultiplier(
        entry.isWeekend,
        entry.isHoliday,
        client.weekendMultiplier,
        client.holidayMultiplier,
      );
      // Per visit — or per block for an increment-billed type — so the entry's
      // count applies, exactly as it does on the invoice line.
      amount += rate.rate * quantityOf(entry) * mult;
    }
  } else if (entry.hours != null && entry.hours > 0) {
    const resolved = await resolveDayTypeRate(
      (key) => getClientRateForDate(client.id, key, entry.date),
      [`hourly-${entry.employeeRole}`, "hourly"],
      entry.isWeekend,
      entry.isHoliday,
      client.weekendMultiplier,
      client.holidayMultiplier,
    );
    if (resolved) amount += entry.hours * resolved.rate * resolved.multiplier;
  }

  // Mileage / per-diem bill at the CLIENT rate when Molly set one, else the
  // employee reimbursement rate — the exact fallback the invoice uses.
  if ((entry.mileage ?? 0) > 0 || (entry.perDiem ?? 0) > 0) {
    const needsMileage = (entry.mileage ?? 0) > 0;
    const needsPerDiem = (entry.perDiem ?? 0) > 0;
    const clientMileage = needsMileage
      ? await getClientRateForDate(client.id, "mileage", entry.date)
      : undefined;
    const clientPerDiem = needsPerDiem
      ? await getClientRateForDate(client.id, "per-diem", entry.date)
      : undefined;
    const needEmpFallback =
      (needsMileage && !clientMileage) || (needsPerDiem && !clientPerDiem);
    const empRate = needEmpFallback
      ? await getEmployeeRateForDate(entry.employeeId, entry.date)
      : undefined;
    if (needsMileage) {
      const rate = clientMileage?.rate ?? empRate?.mileageRate;
      if (rate != null) amount += entry.mileage! * rate;
    }
    if (needsPerDiem) {
      const rate = clientPerDiem?.rate ?? empRate?.perDiemRate;
      if (rate != null) amount += entry.perDiem! * rate;
    }
  }
  return amount;
}

router.get("/reports/payroll", requireAdmin, async (req, res, next) => {
  try {
    const range = parseRange(req.query.start, req.query.end);
    if (!range) {
      res.status(400).json({ message: "Provide a valid date range (start <= end, YYYY-MM-DD)" });
      return;
    }
    const entries = await approvedEntriesInRange(range.start, range.end);
    // Per-client weekend/holiday multipliers (default 1) — fetched once.
    const clientById = new Map(
      (await db.select().from(clientsTable)).map((c) => [c.id, c]),
    );

    type EmployeeGroup = {
      employeeId: string;
      employeeName: string;
      employeeRole: string;
      lines: Record<string, unknown>[];
      visitCount: number;
      totalHours: number;
      basePay: number;
      mileagePay: number;
      perDiemPay: number;
      total: number;
    };
    const groups = new Map<string, EmployeeGroup>();
    let missingRateCount = 0;

    for (const entry of entries) {
      const rate = await getEmployeeRateForDate(entry.employeeId, entry.date);
      const client = clientById.get(entry.clientId);
      const wM = client?.weekendMultiplier ?? 1;
      const hM = client?.holidayMultiplier ?? 1;

      // Resolve this entry's pay + weekend/holiday multiplier (see rate-lookup):
      // - visit entries: per-discipline visit pay × the client day multiplier;
      // - hourly entries: per-client hourly pay (honoring explicit weekend/
      //   holiday rate rows), falling back to the employee's flat hourly rate.
      let visitPayRate: number | undefined;
      let hourlyPayRate: number | undefined;
      let dayMultiplier = pickDayMultiplier(entry.isWeekend, entry.isHoliday, wM, hM);
      if (entry.visitType) {
        visitPayRate = (
          await getVisitPayRateForDate(entry.employeeRole, entry.visitType, entry.date)
        )?.rate;
      } else if (entry.hours != null) {
        const resolved = await resolveDayTypeRate(
          (key) => getClientPayRateForDate(entry.clientId, key, entry.date),
          [`hourly-${entry.employeeRole}`, "hourly"],
          entry.isWeekend,
          entry.isHoliday,
          wM,
          hM,
        );
        if (resolved) {
          hourlyPayRate = resolved.rate;
          dayMultiplier = resolved.multiplier;
        }
      }
      // All pay math lives in lib/payroll-calc.ts (pure + unit tested).
      const { multiplier, basePay, mileagePay, perDiemPay, total, missingRate } =
        computePayrollAmounts(entry, rate, { visitPayRate, hourlyPayRate, multiplier: dayMultiplier });
      if (missingRate) missingRateCount += 1;

      let group = groups.get(entry.employeeId);
      if (!group) {
        group = {
          employeeId: entry.employeeId,
          employeeName: entry.employeeName,
          employeeRole: entry.employeeRole,
          lines: [],
          visitCount: 0,
          totalHours: 0,
          basePay: 0,
          mileagePay: 0,
          perDiemPay: 0,
          total: 0,
        };
        groups.set(entry.employeeId, group);
      }
      group.lines.push({
        entryId: String(entry.id),
        date: entry.date,
        ...(entry.endDate ? { endDate: entry.endDate } : {}),
        clientName: entry.clientName,
        ...(entry.visitType ? { visitType: entry.visitType } : {}),
        ...(entry.visitType && entry.quantity !== 1 ? { quantity: entry.quantity } : {}),
        ...(entry.hours != null ? { hours: entry.hours } : {}),
        // One-off "Other" work: labeled and carrying the employee's
        // description so the export reads like Molly's spreadsheets.
        ...(entry.isOther ? { isOther: true, description: entry.note ?? "" } : {}),
        isWeekend: entry.isWeekend,
        isHoliday: entry.isHoliday,
        multiplier,
        basePay: round2(basePay),
        ...(entry.mileage != null ? { mileage: entry.mileage } : {}),
        mileagePay: round2(mileagePay),
        ...(entry.perDiem != null ? { perDiem: entry.perDiem } : {}),
        perDiemPay: round2(perDiemPay),
        total,
        missingRate,
      });
      if (entry.visitType) group.visitCount += quantityOf(entry);
      if (entry.hours != null) group.totalHours += entry.hours;
      group.basePay = round2(group.basePay + basePay);
      group.mileagePay = round2(group.mileagePay + mileagePay);
      group.perDiemPay = round2(group.perDiemPay + perDiemPay);
      group.total = round2(group.total + total);
    }

    const employees = [...groups.values()].sort((a, b) =>
      a.employeeName.localeCompare(b.employeeName),
    );
    const grandTotal = round2(employees.reduce((sum, g) => sum + g.total, 0));
    res.json({
      start: range.start,
      end: range.end,
      employees,
      grandTotal,
      entryCount: entries.length,
      missingRateCount,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/reports/invoice", requireAdmin, async (req, res, next) => {
  try {
    const range = parseRange(req.query.start, req.query.end);
    const clientId = req.query.clientId;
    if (typeof clientId !== "string" || clientId.length === 0) {
      res.status(400).json({ message: "Provide a clientId" });
      return;
    }
    if (!range) {
      res.status(400).json({ message: "Provide a valid date range (start <= end, YYYY-MM-DD)" });
      return;
    }
    const report = await computeInvoiceReport(clientId, range.start, range.end);
    if (!report) {
      res.status(404).json({ message: "Client not found" });
      return;
    }
    res.json(report);
  } catch (err) {
    next(err);
  }
});

router.get("/reports/reconciliation", requireAdmin, async (req, res, next) => {
  try {
    const range = parseRange(req.query.start, req.query.end);
    const clientId = req.query.clientId;
    if (typeof clientId !== "string" || clientId.length === 0) {
      res.status(400).json({ message: "Provide a clientId" });
      return;
    }
    if (!range) {
      res.status(400).json({ message: "Provide a valid date range (start <= end, YYYY-MM-DD)" });
      return;
    }
    const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
    if (!client) {
      res.status(404).json({ message: "Client not found" });
      return;
    }

    const entries = (await approvedEntriesInRange(range.start, range.end)).filter(
      (e) => e.clientId === clientId,
    );

    // Price each entry exactly as the invoice does, then let the pure builder
    // carry the billed dollars onto every line, subtotal, and the grand total.
    // Summing per-entry amounts reconciles to the invoice total (see
    // resolveEntryBilledAmount).
    const annotated: ReconciliationEntryInput[] = [];
    for (const entry of entries) {
      annotated.push({
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
        isWeekend: entry.isWeekend,
        isHoliday: entry.isHoliday,
        note: entry.note,
        ...(entry.isOther ? { isOther: true } : {}),
        amount: await resolveEntryBilledAmount(entry, client),
      });
    }

    const { employees, totals } = buildReconciliationReport(annotated);

    res.json({
      clientId,
      clientName: client.name,
      start: range.start,
      end: range.end,
      employees,
      totals,
      entryCount: entries.length,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
