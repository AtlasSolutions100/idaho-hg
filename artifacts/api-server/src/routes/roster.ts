import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  clientsTable,
  employeesTable,
  clientRatesTable,
  employeeRatesTable,
  type ClientRow,
  type EmployeeRow,
} from "@workspace/db";
import { CreateClientBody, CreateEmployeeBody } from "@workspace/api-zod";

const router: IRouter = Router();

// Seed the roster tables once from the original hardcoded roster so
// existing time entries and rate rows (ids "1".."6") line up.
const seedClients = [
  { id: "1", name: "St. Luke's Health System" },
  { id: "2", name: "Weiser Memorial Hospital" },
  { id: "3", name: "Idaho Youth Ranch" },
  { id: "4", name: "Treasure Valley Outpatient Clinic" },
  { id: "5", name: "Meridian Senior Care" },
];

const seedEmployees = [
  { id: "1", name: "Sarah Martinez", role: "RN" },
  { id: "2", name: "James Chen", role: "PT" },
  { id: "3", name: "Emily Rodriguez", role: "RN" },
  { id: "4", name: "Michael Thompson", role: "OT" },
  { id: "5", name: "Jessica Park", role: "PT" },
  { id: "6", name: "David Williams", role: "RN" },
];

let seeded = false;
export async function ensureRosterSeeded() {
  if (seeded) return;
  const [clientRow] = await db.select().from(clientsTable).limit(1);
  if (!clientRow) {
    await db.insert(clientsTable).values(seedClients);
  }
  const [employeeRow] = await db.select().from(employeesTable).limit(1);
  if (!employeeRow) {
    await db.insert(employeesTable).values(seedEmployees);
  }
  seeded = true;
}

function serializeClient(row: ClientRow) {
  return { id: row.id, name: row.name, active: row.active };
}

function serializeEmployee(row: EmployeeRow) {
  return { id: row.id, name: row.name, role: row.role, active: row.active };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

router.get("/clients", async (_req, res, next) => {
  try {
    await ensureRosterSeeded();
    const rows = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.active, true));
    rows.sort((a, b) => a.name.localeCompare(b.name));
    res.json(rows.map(serializeClient));
  } catch (err) {
    next(err);
  }
});

router.post("/clients", async (req, res, next) => {
  try {
    await ensureRosterSeeded();
    const parsed = CreateClientBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid client" });
      return;
    }
    const body = parsed.data;
    const name = body.name.trim();
    if (!name) {
      res.status(400).json({ message: "Client name is required" });
      return;
    }
    const id = randomUUID();
    const [row] = await db
      .insert(clientsTable)
      .values({ id, name })
      .returning();
    await db.insert(clientRatesTable).values({
      clientId: id,
      clientName: name,
      visitType: body.visitType,
      rate: body.rate,
      effectiveDate: today(),
    });
    res.status(201).json(serializeClient(row));
  } catch (err) {
    next(err);
  }
});

router.delete("/clients/:id", async (req, res, next) => {
  try {
    await ensureRosterSeeded();
    const [row] = await db
      .update(clientsTable)
      .set({ active: false })
      .where(eq(clientsTable.id, req.params.id))
      .returning();
    if (!row) {
      res.status(404).json({ message: "Client not found" });
      return;
    }
    res.json(serializeClient(row));
  } catch (err) {
    next(err);
  }
});

router.get("/employees", async (_req, res, next) => {
  try {
    await ensureRosterSeeded();
    const rows = await db
      .select()
      .from(employeesTable)
      .where(eq(employeesTable.active, true));
    rows.sort((a, b) => a.name.localeCompare(b.name));
    res.json(rows.map(serializeEmployee));
  } catch (err) {
    next(err);
  }
});

router.post("/employees", async (req, res, next) => {
  try {
    await ensureRosterSeeded();
    const parsed = CreateEmployeeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid employee" });
      return;
    }
    const body = parsed.data;
    const name = body.name.trim();
    const role = body.role.trim();
    if (!name || !role) {
      res.status(400).json({ message: "Employee name and role are required" });
      return;
    }
    const id = randomUUID();
    const [row] = await db
      .insert(employeesTable)
      .values({ id, name, role })
      .returning();
    await db.insert(employeeRatesTable).values({
      employeeId: id,
      employeeName: name,
      employeeRole: role,
      hourlyRate: body.hourlyRate,
      visitRate: body.visitRate,
      mileageRate: body.mileageRate,
      perDiemRate: body.perDiemRate,
      weekendMultiplier: body.weekendMultiplier,
      holidayMultiplier: body.holidayMultiplier,
      effectiveDate: today(),
    });
    res.status(201).json(serializeEmployee(row));
  } catch (err) {
    next(err);
  }
});

router.delete("/employees/:id", async (req, res, next) => {
  try {
    await ensureRosterSeeded();
    const [row] = await db
      .update(employeesTable)
      .set({ active: false })
      .where(eq(employeesTable.id, req.params.id))
      .returning();
    if (!row) {
      res.status(404).json({ message: "Employee not found" });
      return;
    }
    res.json(serializeEmployee(row));
  } catch (err) {
    next(err);
  }
});

export default router;
