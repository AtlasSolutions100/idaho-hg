import { Router, type IRouter } from "express";
import { eq, and, gte, lte, asc } from "drizzle-orm";
import {
  db,
  timeEntriesTable,
  clientsTable,
  type TimeEntryRow,
} from "@workspace/db";
import { getClientRateForDate, getEmployeeRateForDate } from "../lib/rate-lookup";
import { computePayrollAmounts, round2 } from "../lib/payroll-calc";
import { buildInvoiceLines, type InvoiceEntryInput } from "../lib/invoice-lines";

const router: IRouter = Router();

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

router.get("/reports/payroll", async (req, res, next) => {
  try {
    const range = parseRange(req.query.start, req.query.end);
    if (!range) {
      res.status(400).json({ message: "Provide a valid date range (start <= end, YYYY-MM-DD)" });
      return;
    }
    const entries = await approvedEntriesInRange(range.start, range.end);

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
      // Weekend/holiday multiplier rule and all pay math live in
      // lib/payroll-calc.ts (pure + unit tested).
      const { multiplier, basePay, mileagePay, perDiemPay, total, missingRate } =
        computePayrollAmounts(entry, rate);
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
        clientName: entry.clientName,
        ...(entry.visitType ? { visitType: entry.visitType } : {}),
        ...(entry.hours != null ? { hours: entry.hours } : {}),
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
      if (entry.visitType) group.visitCount += 1;
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

router.get("/reports/invoice", async (req, res, next) => {
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
        const rate = await getClientRateForDate(clientId, entry.visitType, entry.date);
        if (rate) input.visitRate = rate.rate;
      } else if (entry.hours != null && entry.hours > 0) {
        const rate = await getClientRateForDate(clientId, "hourly", entry.date);
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

    res.json({
      clientId,
      clientName: client.name,
      start: range.start,
      end: range.end,
      lines,
      total,
      entryCount: entries.length,
      missingRateCount,
      unbilledCount,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/reports/reconciliation", async (req, res, next) => {
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

    const lines = entries.map((entry) => ({
      entryId: String(entry.id),
      date: entry.date,
      employeeName: entry.employeeName,
      employeeRole: entry.employeeRole,
      ...(entry.visitType ? { visitType: entry.visitType } : {}),
      ...(entry.hours != null ? { hours: entry.hours } : {}),
      note: entry.note ?? "",
    }));

    res.json({
      clientId,
      clientName: client.name,
      start: range.start,
      end: range.end,
      lines,
      entryCount: entries.length,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
