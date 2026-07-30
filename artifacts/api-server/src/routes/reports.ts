import { Router, type IRouter } from "express";
import { eq, and, gte, lte, asc } from "drizzle-orm";
import {
  db,
  timeEntriesTable,
  clientsTable,
  type TimeEntryRow,
} from "@workspace/db";
import { getClientRateForDate, getEmployeeRateForDate } from "../lib/rate-lookup";

const router: IRouter = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseRange(start: unknown, end: unknown): { start: string; end: string } | null {
  if (typeof start !== "string" || typeof end !== "string") return null;
  if (!DATE_RE.test(start) || !DATE_RE.test(end)) return null;
  if (start > end) return null;
  return { start, end };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

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
      const missingRate = !rate;
      if (missingRate) missingRateCount += 1;

      // Weekend/holiday rule: if an entry is flagged as both weekend AND
      // holiday, we apply only the HIGHER of the two multipliers (they do
      // not stack). Normal entries use multiplier 1.
      let multiplier = 1;
      if (rate) {
        if (entry.isWeekend && entry.isHoliday) {
          multiplier = Math.max(rate.weekendMultiplier, rate.holidayMultiplier);
        } else if (entry.isWeekend) {
          multiplier = rate.weekendMultiplier;
        } else if (entry.isHoliday) {
          multiplier = rate.holidayMultiplier;
        }
      }

      let basePay = 0;
      if (rate) {
        if (entry.visitType) {
          basePay = rate.visitRate * multiplier;
        } else if (entry.hours != null) {
          basePay = entry.hours * rate.hourlyRate * multiplier;
        }
      }
      const mileagePay = rate && entry.mileage != null ? entry.mileage * rate.mileageRate : 0;
      const perDiemPay = rate && entry.perDiem != null ? entry.perDiem * rate.perDiemRate : 0;
      const total = round2(basePay + mileagePay + perDiemPay);

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

    const lines: Record<string, unknown>[] = [];
    let total = 0;
    let missingRateCount = 0;
    let unbilledCount = 0;

    for (const entry of entries) {
      // Client rates exist per visit type only. Visit entries bill at the
      // client's rate for that visit type on the entry date. Hourly-only
      // entries (no visit type) have no client rate concept, so they are
      // listed as unbilled with a note instead of being silently dropped.
      if (entry.visitType) {
        const rate = await getClientRateForDate(clientId, entry.visitType, entry.date);
        const missingRate = !rate;
        if (missingRate) missingRateCount += 1;
        const amount = rate ? round2(rate.rate) : 0;
        total = round2(total + amount);
        lines.push({
          entryId: String(entry.id),
          date: entry.date,
          employeeName: entry.employeeName,
          employeeRole: entry.employeeRole,
          visitType: entry.visitType,
          ...(entry.hours != null ? { hours: entry.hours } : {}),
          ...(rate ? { rate: rate.rate } : {}),
          amount,
          billable: true,
          missingRate,
          ...(missingRate ? { note: "No billing rate on file for this visit type/date" } : {}),
        });
      } else {
        unbilledCount += 1;
        lines.push({
          entryId: String(entry.id),
          date: entry.date,
          employeeName: entry.employeeName,
          employeeRole: entry.employeeRole,
          ...(entry.hours != null ? { hours: entry.hours } : {}),
          amount: 0,
          billable: false,
          missingRate: false,
          note: "Hourly entry — no per-hour billing rate; not included in total",
        });
      }
    }

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
