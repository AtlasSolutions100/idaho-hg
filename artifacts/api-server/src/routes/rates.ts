import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import {
  db,
  clientRatesTable,
  employeeRatesTable,
  clientsTable,
  employeesTable,
  type ClientRateRow,
  type EmployeeRateRow,
} from "@workspace/db";
import {
  UpdateClientRateBody,
  UpdateEmployeeRateBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

function serializeClientRate(row: ClientRateRow) {
  return {
    id: String(row.id),
    clientId: row.clientId,
    clientName: row.clientName,
    visitType: row.visitType,
    rate: row.rate,
    effectiveDate: row.effectiveDate,
  };
}

function serializeEmployeeRate(row: EmployeeRateRow) {
  return {
    id: String(row.id),
    employeeId: row.employeeId,
    employeeName: row.employeeName,
    employeeRole: row.employeeRole,
    hourlyRate: row.hourlyRate,
    visitRate: row.visitRate,
    mileageRate: row.mileageRate,
    perDiemRate: row.perDiemRate,
    weekendMultiplier: row.weekendMultiplier,
    holidayMultiplier: row.holidayMultiplier,
    effectiveDate: row.effectiveDate,
  };
}

// Rates are stored as append-only history: every change inserts a new row
// with its own effective date. The "current" rate for a client/visit-type or
// employee is the row with the latest effective date (ties broken by newest id).
function isNewerRate(
  a: { effectiveDate: string; id: number },
  b: { effectiveDate: string; id: number },
) {
  if (a.effectiveDate !== b.effectiveDate) return a.effectiveDate > b.effectiveDate;
  return a.id > b.id;
}

function latestPerGroup<T extends { effectiveDate: string; id: number }>(
  rows: T[],
  keyOf: (row: T) => string,
): T[] {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const key = keyOf(row);
    const existing = latest.get(key);
    if (!existing || isNewerRate(row, existing)) {
      latest.set(key, row);
    }
  }
  return [...latest.values()];
}

// Seed initial rates on first use so Molly starts from the current known rates
const seedClientRates = [
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "skilled-nursing", rate: 95, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "physical-therapy", rate: 105, effectiveDate: "2024-01-01" },
  { clientId: "2", clientName: "Weiser Memorial Hospital", visitType: "skilled-nursing", rate: 88, effectiveDate: "2024-01-01" },
  { clientId: "2", clientName: "Weiser Memorial Hospital", visitType: "physical-therapy", rate: 98, effectiveDate: "2024-01-01" },
  { clientId: "3", clientName: "Idaho Youth Ranch", visitType: "skilled-nursing", rate: 82, effectiveDate: "2024-01-01" },
  { clientId: "4", clientName: "Treasure Valley Outpatient Clinic", visitType: "physical-therapy", rate: 92, effectiveDate: "2024-01-01" },
  { clientId: "4", clientName: "Treasure Valley Outpatient Clinic", visitType: "occupational-therapy", rate: 90, effectiveDate: "2024-01-01" },
];

// Placeholder starting pay rates per discipline — Molly sets real numbers on
// the Employee Rates page (each change is tracked with an effective date).
const roleDefaultRates: Record<string, { hourlyRate: number; visitRate: number }> = {
  PT: { hourlyRate: 52, visitRate: 82 },
  RN: { hourlyRate: 48, visitRate: 75 },
  OT: { hourlyRate: 50, visitRate: 78 },
  PTA: { hourlyRate: 40, visitRate: 60 },
  SLP: { hourlyRate: 52, visitRate: 82 },
  LCSW: { hourlyRate: 50, visitRate: 75 },
};

const seedEmployeeRoster: Array<{ employeeId: string; employeeName: string; employeeRole: string }> = [
  { employeeId: "1", employeeName: "Molly Hodge", employeeRole: "PT" },
  { employeeId: "2", employeeName: "Dale Gibbs", employeeRole: "PT" },
  { employeeId: "3", employeeName: "Emily Greer", employeeRole: "PT" },
  { employeeId: "4", employeeName: "Quinton Erhard", employeeRole: "PT" },
  { employeeId: "5", employeeName: "Adrian Eddins", employeeRole: "RN" },
  { employeeId: "6", employeeName: "Ronda Stewart", employeeRole: "RN" },
  { employeeId: "7", employeeName: "Amber Edwards", employeeRole: "RN" },
  { employeeId: "8", employeeName: "Sandy Clayton", employeeRole: "RN" },
  { employeeId: "9", employeeName: "Bree Whiting", employeeRole: "RN" },
  { employeeId: "10", employeeName: "Brandon Whiting", employeeRole: "OT" },
  { employeeId: "11", employeeName: "Joshua Johansen", employeeRole: "OT" },
  { employeeId: "12", employeeName: "Lee Hamilton", employeeRole: "OT" },
  { employeeId: "13", employeeName: "Lee Ormsby", employeeRole: "PTA" },
  { employeeId: "14", employeeName: "Ameliana Samarin", employeeRole: "SLP" },
  { employeeId: "15", employeeName: "Mel Plourde", employeeRole: "LCSW" },
  { employeeId: "16", employeeName: "Paige Barbero", employeeRole: "PT" },
];

const seedEmployeeRates = seedEmployeeRoster.map((emp) => {
  const defaults = roleDefaultRates[emp.employeeRole] ?? { hourlyRate: 45, visitRate: 70 };
  return {
    ...emp,
    ...defaults,
    mileageRate: 0.655,
    perDiemRate: 45,
    weekendMultiplier: 1.5,
    holidayMultiplier: 2,
    effectiveDate: "2024-01-01",
  };
});

let seeded = false;
async function ensureSeeded() {
  if (seeded) return;
  const [clientRow] = await db.select().from(clientRatesTable).limit(1);
  if (!clientRow) {
    await db.insert(clientRatesTable).values(seedClientRates);
  }
  const [employeeRow] = await db.select().from(employeeRatesTable).limit(1);
  if (!employeeRow) {
    await db.insert(employeeRatesTable).values(seedEmployeeRates);
  }
  seeded = true;
}

router.get("/client-rates", async (_req, res, next) => {
  try {
    await ensureSeeded();
    const rows = await db.select().from(clientRatesTable);
    // Hide rates for removed (inactive) clients; unknown ids stay visible.
    const inactive = new Set(
      (await db.select().from(clientsTable).where(eq(clientsTable.active, false))).map((c) => c.id),
    );
    const current = latestPerGroup(rows.filter((r) => !inactive.has(r.clientId)), (row) => `${row.clientId}::${row.visitType}`)
      .sort((a, b) =>
        a.clientName.localeCompare(b.clientName) || a.visitType.localeCompare(b.visitType),
      );
    res.json(current.map(serializeClientRate));
  } catch (err) {
    next(err);
  }
});

// Editing a rate never overwrites: it inserts a new history row so past
// payroll/invoices can still resolve the rate that applied on their dates.
router.patch("/client-rates/:id", async (req, res, next) => {
  try {
    const parsed = UpdateClientRateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid rate update" });
      return;
    }
    const numericId = Number(req.params.id);
    if (!Number.isInteger(numericId)) {
      res.status(404).json({ message: "Rate not found" });
      return;
    }
    const [existing] = await db
      .select()
      .from(clientRatesTable)
      .where(eq(clientRatesTable.id, numericId));
    if (!existing) {
      res.status(404).json({ message: "Rate not found" });
      return;
    }
    const [row] = await db
      .insert(clientRatesTable)
      .values({
        clientId: existing.clientId,
        clientName: existing.clientName,
        visitType: existing.visitType,
        rate: parsed.data.rate,
        effectiveDate: parsed.data.effectiveDate,
      })
      .returning();
    res.json(serializeClientRate(row));
  } catch (err) {
    next(err);
  }
});

router.get("/client-rates/:id/history", async (req, res, next) => {
  try {
    await ensureSeeded();
    const numericId = Number(req.params.id);
    if (!Number.isInteger(numericId)) {
      res.status(404).json({ message: "Rate not found" });
      return;
    }
    const [existing] = await db
      .select()
      .from(clientRatesTable)
      .where(eq(clientRatesTable.id, numericId));
    if (!existing) {
      res.status(404).json({ message: "Rate not found" });
      return;
    }
    const rows = await db
      .select()
      .from(clientRatesTable)
      .where(
        and(
          eq(clientRatesTable.clientId, existing.clientId),
          eq(clientRatesTable.visitType, existing.visitType),
        ),
      )
      .orderBy(desc(clientRatesTable.effectiveDate), desc(clientRatesTable.id));
    res.json(rows.map(serializeClientRate));
  } catch (err) {
    next(err);
  }
});

router.get("/employee-rates", async (_req, res, next) => {
  try {
    await ensureSeeded();
    const rows = await db.select().from(employeeRatesTable);
    // Hide rates for removed (inactive) employees; unknown ids stay visible.
    const inactive = new Set(
      (await db.select().from(employeesTable).where(eq(employeesTable.active, false))).map((e) => e.id),
    );
    const current = latestPerGroup(rows.filter((r) => !inactive.has(r.employeeId)), (row) => row.employeeId).sort((a, b) =>
      a.employeeName.localeCompare(b.employeeName),
    );
    res.json(current.map(serializeEmployeeRate));
  } catch (err) {
    next(err);
  }
});

router.patch("/employee-rates/:id", async (req, res, next) => {
  try {
    const parsed = UpdateEmployeeRateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid rate update" });
      return;
    }
    const numericId = Number(req.params.id);
    if (!Number.isInteger(numericId)) {
      res.status(404).json({ message: "Rate not found" });
      return;
    }
    const [existing] = await db
      .select()
      .from(employeeRatesTable)
      .where(eq(employeeRatesTable.id, numericId));
    if (!existing) {
      res.status(404).json({ message: "Rate not found" });
      return;
    }
    const body = parsed.data;
    const [row] = await db
      .insert(employeeRatesTable)
      .values({
        employeeId: existing.employeeId,
        employeeName: existing.employeeName,
        employeeRole: existing.employeeRole,
        hourlyRate: body.hourlyRate,
        visitRate: body.visitRate,
        mileageRate: body.mileageRate,
        perDiemRate: body.perDiemRate,
        weekendMultiplier: body.weekendMultiplier,
        holidayMultiplier: body.holidayMultiplier,
        effectiveDate: body.effectiveDate,
      })
      .returning();
    res.json(serializeEmployeeRate(row));
  } catch (err) {
    next(err);
  }
});

router.get("/employee-rates/:id/history", async (req, res, next) => {
  try {
    await ensureSeeded();
    const numericId = Number(req.params.id);
    if (!Number.isInteger(numericId)) {
      res.status(404).json({ message: "Rate not found" });
      return;
    }
    const [existing] = await db
      .select()
      .from(employeeRatesTable)
      .where(eq(employeeRatesTable.id, numericId));
    if (!existing) {
      res.status(404).json({ message: "Rate not found" });
      return;
    }
    const rows = await db
      .select()
      .from(employeeRatesTable)
      .where(eq(employeeRatesTable.employeeId, existing.employeeId))
      .orderBy(desc(employeeRatesTable.effectiveDate), desc(employeeRatesTable.id));
    res.json(rows.map(serializeEmployeeRate));
  } catch (err) {
    next(err);
  }
});

export default router;
