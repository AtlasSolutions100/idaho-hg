import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import {
  db,
  clientRatesTable,
  employeeRatesTable,
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

const seedEmployeeRates = [
  { employeeId: "1", employeeName: "Sarah Martinez", employeeRole: "RN", hourlyRate: 48.5, visitRate: 75, mileageRate: 0.655, perDiemRate: 45, weekendMultiplier: 1.5, holidayMultiplier: 2, effectiveDate: "2024-01-01" },
  { employeeId: "2", employeeName: "James Chen", employeeRole: "PT", hourlyRate: 52, visitRate: 82, mileageRate: 0.655, perDiemRate: 45, weekendMultiplier: 1.5, holidayMultiplier: 2, effectiveDate: "2024-01-01" },
  { employeeId: "3", employeeName: "Emily Rodriguez", employeeRole: "RN", hourlyRate: 46, visitRate: 72, mileageRate: 0.655, perDiemRate: 45, weekendMultiplier: 1.5, holidayMultiplier: 2, effectiveDate: "2024-01-01" },
  { employeeId: "4", employeeName: "Michael Thompson", employeeRole: "OT", hourlyRate: 50, visitRate: 78, mileageRate: 0.655, perDiemRate: 45, weekendMultiplier: 1.5, holidayMultiplier: 2, effectiveDate: "2024-01-01" },
  { employeeId: "5", employeeName: "Jessica Park", employeeRole: "PT", hourlyRate: 51, visitRate: 80, mileageRate: 0.655, perDiemRate: 45, weekendMultiplier: 1.5, holidayMultiplier: 2, effectiveDate: "2024-01-01" },
  { employeeId: "6", employeeName: "David Williams", employeeRole: "RN", hourlyRate: 49, visitRate: 76, mileageRate: 0.655, perDiemRate: 45, weekendMultiplier: 1.5, holidayMultiplier: 2, effectiveDate: "2024-01-01" },
];

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
    const rows = await db
      .select()
      .from(clientRatesTable)
      .orderBy(asc(clientRatesTable.clientName), asc(clientRatesTable.id));
    res.json(rows.map(serializeClientRate));
  } catch (err) {
    next(err);
  }
});

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
    const [row] = await db
      .update(clientRatesTable)
      .set({ rate: parsed.data.rate, effectiveDate: parsed.data.effectiveDate })
      .where(eq(clientRatesTable.id, numericId))
      .returning();
    if (!row) {
      res.status(404).json({ message: "Rate not found" });
      return;
    }
    res.json(serializeClientRate(row));
  } catch (err) {
    next(err);
  }
});

router.get("/employee-rates", async (_req, res, next) => {
  try {
    await ensureSeeded();
    const rows = await db
      .select()
      .from(employeeRatesTable)
      .orderBy(asc(employeeRatesTable.employeeName), asc(employeeRatesTable.id));
    res.json(rows.map(serializeEmployeeRate));
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
    const body = parsed.data;
    const [row] = await db
      .update(employeeRatesTable)
      .set({
        hourlyRate: body.hourlyRate,
        visitRate: body.visitRate,
        mileageRate: body.mileageRate,
        perDiemRate: body.perDiemRate,
        weekendMultiplier: body.weekendMultiplier,
        holidayMultiplier: body.holidayMultiplier,
        effectiveDate: body.effectiveDate,
      })
      .where(eq(employeeRatesTable.id, numericId))
      .returning();
    if (!row) {
      res.status(404).json({ message: "Rate not found" });
      return;
    }
    res.json(serializeEmployeeRate(row));
  } catch (err) {
    next(err);
  }
});

export default router;
