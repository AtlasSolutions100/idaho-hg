import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import {
  db,
  timeEntriesTable,
  clientsTable,
  employeesTable,
  type TimeEntryRow,
} from "@workspace/db";
import { ensureRosterSeeded } from "./roster";
import {
  CreateTimeEntryBody,
  ListTimeEntriesQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

function serialize(row: TimeEntryRow) {
  return {
    id: String(row.id),
    employeeId: row.employeeId,
    employeeName: row.employeeName,
    employeeRole: row.employeeRole,
    clientId: row.clientId,
    clientName: row.clientName,
    date: row.date,
    ...(row.visitType ? { visitType: row.visitType } : {}),
    ...(row.hours != null ? { hours: row.hours } : {}),
    ...(row.mileage != null ? { mileage: row.mileage } : {}),
    ...(row.perDiem != null ? { perDiem: row.perDiem } : {}),
    isWeekend: row.isWeekend,
    isHoliday: row.isHoliday,
    ...(row.note ? { note: row.note } : {}),
    status: row.status,
    submittedAt: row.submittedAt.toISOString(),
    ...(row.approvedAt ? { approvedAt: row.approvedAt.toISOString() } : {}),
  };
}

router.get("/time-entries", async (req, res, next) => {
  try {
    const query = ListTimeEntriesQueryParams.parse(req.query);
    let rows = await db
      .select()
      .from(timeEntriesTable)
      .orderBy(desc(timeEntriesTable.date), desc(timeEntriesTable.id));
    if (query.employeeId) {
      rows = rows.filter((r) => r.employeeId === query.employeeId);
    }
    if (query.status) {
      rows = rows.filter((r) => r.status === query.status);
    }
    res.json(rows.map(serialize));
  } catch (err) {
    next(err);
  }
});

router.post("/time-entries", async (req, res, next) => {
  try {
    const parsed = CreateTimeEntryBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid time entry" });
      return;
    }
    const body = parsed.data;
    await ensureRosterSeeded();
    const [employee] = await db
      .select()
      .from(employeesTable)
      .where(and(eq(employeesTable.id, body.employeeId), eq(employeesTable.active, true)));
    const [client] = await db
      .select()
      .from(clientsTable)
      .where(and(eq(clientsTable.id, body.clientId), eq(clientsTable.active, true)));
    if (!employee) {
      res.status(400).json({ message: "Unknown employee" });
      return;
    }
    if (!client) {
      res.status(400).json({ message: "Unknown client" });
      return;
    }
    if (!body.visitType && body.hours == null) {
      res.status(400).json({ message: "Provide a visit type or hours" });
      return;
    }
    const [row] = await db
      .insert(timeEntriesTable)
      .values({
        employeeId: body.employeeId,
        employeeName: employee.name,
        employeeRole: employee.role,
        clientId: body.clientId,
        clientName: client.name,
        date: body.date,
        visitType: body.visitType ?? null,
        hours: body.hours ?? null,
        mileage: body.mileage ?? null,
        perDiem: body.perDiem ?? null,
        isWeekend: body.isWeekend,
        isHoliday: body.isHoliday,
        note: body.note ?? null,
        status: "submitted",
      })
      .returning();
    if (!row) {
      res.status(500).json({ message: "Failed to create entry" });
      return;
    }
    res.status(201).json(serialize(row));
  } catch (err) {
    next(err);
  }
});

async function setStatus(
  id: string,
  status: "approved" | "rejected",
): Promise<TimeEntryRow | undefined> {
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) return undefined;
  const [row] = await db
    .update(timeEntriesTable)
    .set({
      status,
      approvedAt: status === "approved" ? new Date() : null,
    })
    .where(eq(timeEntriesTable.id, numericId))
    .returning();
  return row;
}

router.post("/time-entries/:id/approve", async (req, res, next) => {
  try {
    const row = await setStatus(req.params.id, "approved");
    if (!row) {
      res.status(404).json({ message: "Entry not found" });
      return;
    }
    res.json(serialize(row));
  } catch (err) {
    next(err);
  }
});

router.post("/time-entries/:id/reject", async (req, res, next) => {
  try {
    const row = await setStatus(req.params.id, "rejected");
    if (!row) {
      res.status(404).json({ message: "Entry not found" });
      return;
    }
    res.json(serialize(row));
  } catch (err) {
    next(err);
  }
});

router.post("/time-entries/approve-all", async (_req, res, next) => {
  try {
    const rows = await db
      .update(timeEntriesTable)
      .set({ status: "approved", approvedAt: new Date() })
      .where(eq(timeEntriesTable.status, "submitted"))
      .returning();
    res.json({ approvedCount: rows.length });
  } catch (err) {
    next(err);
  }
});

export default router;
