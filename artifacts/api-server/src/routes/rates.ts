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
  CreateClientRateBody,
  UpdateClientRateBody,
  UpdateEmployeeRateBody,
} from "@workspace/api-zod";
import {
  hasDemoEmployeeData,
  purgeDemoEmployeeData,
} from "../lib/demo-cleanup";

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
  { employeeId: "ed7ff5a6-408c-46ae-a6d1-f8fb6ec85b1b", employeeName: "Molly Hodge", employeeRole: "PT" },
  { employeeId: "70a76167-a476-4268-a2fc-d89c7ed15e6e", employeeName: "Dale Gibbs", employeeRole: "PT" },
  { employeeId: "149d3f0a-08dc-48e4-a2d5-5f74df82e9ba", employeeName: "Emily Greer", employeeRole: "PT" },
  { employeeId: "c173f799-2391-4acb-b7d8-bd6c1f7811ca", employeeName: "Quinton Erhard", employeeRole: "PT" },
  { employeeId: "e2ae91e4-d3d8-4447-b4ce-85de035b6700", employeeName: "Adrian Eddins", employeeRole: "RN" },
  { employeeId: "671910f2-7fa0-4eae-8b61-717191a00bab", employeeName: "Ronda Stewart", employeeRole: "RN" },
  { employeeId: "e0abb6d8-30a9-4cbd-a777-ac134f373872", employeeName: "Amber Edwards", employeeRole: "RN" },
  { employeeId: "cdd04b02-8b43-4b1d-9da6-b394a67cfdfc", employeeName: "Sandy Clayton", employeeRole: "RN" },
  { employeeId: "0b970f7e-1788-4b52-be50-811ad8ce9b9a", employeeName: "Bree Whiting", employeeRole: "RN" },
  { employeeId: "42f630fa-1049-4a46-8a65-70ffcfbe98d5", employeeName: "Brandon Whiting", employeeRole: "OT" },
  { employeeId: "782448f4-2acd-4ee1-a40f-80d930ebcd7f", employeeName: "Joshua Johansen", employeeRole: "OT" },
  { employeeId: "5cc9fff2-5c2e-41cd-bd56-50cce1a5532d", employeeName: "Lee Hamilton", employeeRole: "OT" },
  { employeeId: "1d2c2efe-bed4-4b2e-aba4-194130b0a0b7", employeeName: "Lee Ormsby", employeeRole: "PTA" },
  { employeeId: "1da47ea1-da22-41f3-aef2-542c42d47a21", employeeName: "Ameliana Samarin", employeeRole: "SLP" },
  { employeeId: "5f4d261e-28c3-4bea-a6e4-99e171ac07c0", employeeName: "Mel Plourde", employeeRole: "LCSW" },
  { employeeId: "d324d661-8c8c-4414-be27-855f48d4ed26", employeeName: "Paige Barbero", employeeRole: "PT" },
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
  // Guard: if legacy demo employees (IDs "1"–"6") resurfaced (e.g. via a
  // restored backup), purge them and skip seeding — the database is not
  // fresh, so seeding would only mix demo remnants with real data.
  if (await hasDemoEmployeeData()) {
    await purgeDemoEmployeeData();
    seeded = true;
    return;
  }
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

// Adds a new rate type for an existing client (e.g. an hourly rate). Rejects
// duplicates: once a client has any history rows for a rate type, changes go
// through PATCH so the history stays append-only.
router.post("/client-rates", async (req, res, next) => {
  try {
    await ensureSeeded();
    const parsed = CreateClientRateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid rate" });
      return;
    }
    const { clientId, rateType, rate, effectiveDate } = parsed.data;
    const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
    if (!client || !client.active) {
      res.status(404).json({ message: "Client not found" });
      return;
    }
    const [existing] = await db
      .select()
      .from(clientRatesTable)
      .where(
        and(eq(clientRatesTable.clientId, clientId), eq(clientRatesTable.visitType, rateType)),
      )
      .limit(1);
    if (existing) {
      res
        .status(409)
        .json({ message: "This client already has a rate of this type — edit it instead" });
      return;
    }
    const [row] = await db
      .insert(clientRatesTable)
      .values({
        clientId,
        clientName: client.name,
        visitType: rateType,
        rate,
        effectiveDate,
      })
      .returning();
    res.status(201).json(serializeClientRate(row));
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
