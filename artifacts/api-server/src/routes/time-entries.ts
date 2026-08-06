import { Router, type IRouter } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  db,
  timeEntriesTable,
  clientsTable,
  employeesTable,
  type TimeEntryRow,
} from "@workspace/db";
import { ensureRosterSeeded } from "./roster";
import { DEMO_LOCK_KEY } from "./demo-data";
import {
  CreateTimeEntryBody,
  ListTimeEntriesQueryParams,
} from "@workspace/api-zod";
import { resolveSessionEmployee } from "../lib/employee-auth";

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
    isDemo: row.isDemo,
    submittedAt: row.submittedAt.toISOString(),
    ...(row.approvedAt ? { approvedAt: row.approvedAt.toISOString() } : {}),
  };
}

router.get("/time-entries", async (req, res, next) => {
  try {
    const query = ListTimeEntriesQueryParams.parse(req.query);
    // Signed-in employees (mobile app) only ever see their own entries,
    // regardless of what filter the client sent.
    const session = await resolveSessionEmployee(req);
    if (session.kind === "employee") {
      query.employeeId = session.employee.id;
    } else if (session.kind === "disabled") {
      res.status(403).json({
        code: "SIGN_IN_DISABLED",
        message:
          "Your sign-in has been turned off. Ask Molly if you think this is a mistake.",
      });
      return;
    } else if (session.kind === "unknown") {
      res.status(403).json({
        message:
          "This email isn't on the team roster yet. Ask Molly to add your email, then try again.",
      });
      return;
    }
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
    // When the request carries a signed-in session (mobile app), the entry is
    // always recorded against that employee — the client can't pick another.
    const session = await resolveSessionEmployee(req);
    if (session.kind === "employee") {
      body.employeeId = session.employee.id;
    } else if (session.kind === "disabled") {
      res.status(403).json({
        code: "SIGN_IN_DISABLED",
        message:
          "Your sign-in has been turned off. Ask Molly if you think this is a mistake.",
      });
      return;
    } else if (session.kind === "unknown") {
      res.status(403).json({
        message:
          "This email isn't on the team roster yet. Ask Molly to add your email, then try again.",
      });
      return;
    }
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
    const isDemo = employee.isDemo || client.isDemo;
    const row = await db.transaction(async (tx) => {
      if (isDemo) {
        // Serialize against demo-data removal (same advisory lock) and
        // re-verify the demo records still exist, so a practice entry can
        // never slip in while the wipe is running.
        await tx.execute(sql`select pg_advisory_xact_lock(${DEMO_LOCK_KEY})`);
        const [emp] = await tx
          .select({ id: employeesTable.id })
          .from(employeesTable)
          .where(and(eq(employeesTable.id, body.employeeId), eq(employeesTable.active, true)));
        const [cli] = await tx
          .select({ id: clientsTable.id })
          .from(clientsTable)
          .where(and(eq(clientsTable.id, body.clientId), eq(clientsTable.active, true)));
        if (!emp || !cli) return null;
      }
      const [inserted] = await tx
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
          isDemo,
        })
        .returning();
      return inserted ?? null;
    });
    if (row === null) {
      res.status(400).json({ message: "Unknown employee" });
      return;
    }
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
