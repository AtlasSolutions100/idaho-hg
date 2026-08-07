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
  BatchCreateTimeEntriesBody,
  CreateTimeEntryBody,
  ListTimeEntriesQueryParams,
  UpdateTimeEntryBody,
} from "@workspace/api-zod";
import { resolveSessionEmployee, verifyAdminRequest } from "../lib/employee-auth";
import {
  hoursBetween,
  isHolidayDate,
  isValidDateString,
  isWeekendDate,
} from "../lib/work-calendar";

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
    ...(row.timeIn ? { timeIn: row.timeIn } : {}),
    ...(row.timeOut ? { timeOut: row.timeOut } : {}),
    ...(row.hours != null ? { hours: row.hours } : {}),
    ...(row.mileage != null ? { mileage: row.mileage } : {}),
    ...(row.perDiem != null ? { perDiem: row.perDiem } : {}),
    ...(row.perDiemType ? { perDiemType: row.perDiemType } : {}),
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
    // Molly (the verified admin sign-in) sees everything — her email isn't a
    // roster profile, so without this check she'd be turned away as
    // "not linked" and the payroll page would show nothing.
    const admin = await verifyAdminRequest(req);
    const session = admin.ok ? null : await resolveSessionEmployee(req);
    if (session == null) {
      // admin — no per-employee scoping
    } else if (session.kind === "employee") {
      query.employeeId = session.employee.id;
    } else if (session.kind === "disabled") {
      res.status(403).json({
        code: "SIGN_IN_DISABLED",
        message:
          "Your sign-in has been turned off. Ask Molly if you think this is a mistake.",
      });
      return;
    } else if (session.kind === "pending") {
      res.status(403).json({
        code: "LINK_REQUEST_PENDING",
        message: "Molly still needs to confirm it's you. Check back in a bit.",
      });
      return;
    } else if (session.kind === "unknown") {
      res.status(403).json({
        code: "NOT_LINKED",
        message:
          "This email isn't linked to a team profile yet. Pick your name to get set up.",
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
    // Drafts are private to the employee who wrote them. Only a signed-in,
    // roster-linked employee ever receives drafts — and their list is already
    // pinned to their own id above. Molly (admin), anonymous requests, and
    // caller-supplied employeeId filters never see anyone's drafts.
    if (session?.kind !== "employee") {
      rows = rows.filter((r) => r.status !== "draft");
    }
    if (query.status) {
      rows = rows.filter((r) => r.status === query.status);
    }
    res.json(rows.map(serialize));
  } catch (err) {
    next(err);
  }
});

// How many visit-type entries the client has in the current and previous two
// calendar months — used to warn Molly before turning off visit-type billing
// for a client that employees are actively logging visits against.
router.get("/clients/:id/visit-entry-count", async (req, res, next) => {
  try {
    const clientId = String(req.params.id);
    const now = new Date();
    const since = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const sinceStr = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, "0")}-01`;
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(timeEntriesTable)
      .where(
        and(
          eq(timeEntriesTable.clientId, clientId),
          sql`${timeEntriesTable.visitType} is not null`,
          sql`${timeEntriesTable.date} >= ${sinceStr}`,
        ),
      );
    res.json({ count: row?.count ?? 0 });
  } catch (err) {
    next(err);
  }
});

// How many plain hourly (no visit type) entries the client has in the current
// and previous two calendar months — used to warn Molly before turning ON
// visit-type billing for a client whose employees log plain time in/out.
router.get("/clients/:id/hourly-entry-count", async (req, res, next) => {
  try {
    const clientId = String(req.params.id);
    const now = new Date();
    const since = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const sinceStr = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, "0")}-01`;
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(timeEntriesTable)
      .where(
        and(
          eq(timeEntriesTable.clientId, clientId),
          sql`${timeEntriesTable.visitType} is null`,
          sql`${timeEntriesTable.date} >= ${sinceStr}`,
        ),
      );
    res.json({ count: row?.count ?? 0 });
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
    // Drafts are private to their author, which only means something for a
    // signed-in employee — anonymous requests can't save drafts (they could
    // never see or edit them again anyway).
    if (body.status === "draft" && session.kind !== "employee") {
      res.status(401).json({ message: "Please sign in to save drafts." });
      return;
    }
    if (session.kind === "employee") {
      body.employeeId = session.employee.id;
    } else if (session.kind === "disabled") {
      res.status(403).json({
        code: "SIGN_IN_DISABLED",
        message:
          "Your sign-in has been turned off. Ask Molly if you think this is a mistake.",
      });
      return;
    } else if (session.kind === "pending") {
      res.status(403).json({
        code: "LINK_REQUEST_PENDING",
        message: "Molly still needs to confirm it's you. Check back in a bit.",
      });
      return;
    } else if (session.kind === "unknown") {
      res.status(403).json({
        code: "NOT_LINKED",
        message:
          "This email isn't linked to a team profile yet. Pick your name to get set up.",
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
    // JS Date silently normalizes impossible dates (Feb 30 → Mar 2), which
    // would derive weekend/holiday flags for the wrong day — reject them.
    if (!isValidDateString(body.date)) {
      res.status(400).json({ message: "That date doesn't exist — please check it" });
      return;
    }
    // Clock times take precedence over a raw hours number; both count as
    // "hours provided" for the visit-or-hours requirement.
    const hasTimes = body.timeIn != null || body.timeOut != null;
    let hours: number | null = body.hours ?? null;
    if (hasTimes) {
      if (!body.timeIn || !body.timeOut) {
        res.status(400).json({ message: "Enter both a time in and a time out" });
        return;
      }
      const computed = hoursBetween(body.timeIn, body.timeOut);
      if (computed == null || computed <= 0) {
        res.status(400).json({ message: "Those times don't work out to a valid shift" });
        return;
      }
      hours = computed;
    }
    if (!body.visitType && hours == null) {
      res.status(400).json({ message: "Provide a visit type or your time in and out" });
      return;
    }
    // Visit types only apply to clients that bill by visit type (St. Luke's).
    if (body.visitType && !client.billsByVisitType) {
      res.status(400).json({
        message: `${client.name} doesn't bill by visit type — just log your time in and out.`,
      });
      return;
    }
    // Mileage is only billable when the client's contract includes it.
    if (body.mileage != null && body.mileage > 0 && !client.mileageOnContract) {
      res.status(400).json({
        message: `${client.name} doesn't include mileage on their contract, so mileage can't be submitted for this client.`,
      });
      return;
    }
    // Per diem: the form sends one of two options; both count as one
    // per-diem day for pay. The choice is recorded so pay rules can
    // differentiate later. Legacy numeric perDiem is still accepted from
    // older app versions.
    const perDiemType = body.perDiemType ?? null;
    const perDiem = perDiemType ? 1 : (body.perDiem ?? null);
    // Weekend/holiday are the server's call now — anything the client sent
    // is ignored.
    const isWeekend = isWeekendDate(body.date);
    const isHoliday = isHolidayDate(body.date);
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
          timeIn: hasTimes ? (body.timeIn ?? null) : null,
          timeOut: hasTimes ? (body.timeOut ?? null) : null,
          hours,
          mileage: body.mileage ?? null,
          perDiem,
          perDiemType,
          isWeekend,
          isHoliday,
          note: body.note ?? null,
          status: body.status ?? "submitted",
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

// Batch: one transaction inserts all selected visit types for the same day.
// Mileage and per diem go on the first entry only so they're never doubled.
router.post("/time-entries/batch", async (req, res, next) => {
  try {
    const parsed = BatchCreateTimeEntriesBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid batch request" });
      return;
    }
    const body = parsed.data;
    await ensureRosterSeeded();
    const session = await resolveSessionEmployee(req);
    // Same draft rule as the single-entry route: drafts require a signed-in
    // employee, or nobody could ever see or finish them.
    if (body.status === "draft" && session.kind !== "employee") {
      res.status(401).json({ message: "Please sign in to save drafts." });
      return;
    }
    if (session.kind === "employee") {
      body.employeeId = session.employee.id;
    } else if (session.kind === "disabled") {
      res.status(403).json({ code: "SIGN_IN_DISABLED", message: "Your sign-in has been turned off. Ask Molly if you think this is a mistake." });
      return;
    } else if (session.kind === "pending") {
      res.status(403).json({ code: "LINK_REQUEST_PENDING", message: "Molly still needs to confirm it's you. Check back in a bit." });
      return;
    } else if (session.kind === "unknown") {
      res.status(403).json({ code: "NOT_LINKED", message: "This email isn't linked to a team profile yet. Pick your name to get set up." });
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
    if (!isValidDateString(body.date)) {
      res.status(400).json({ message: "That date doesn't exist — please check it" });
      return;
    }
    if (body.mileage != null && body.mileage > 0 && !client.mileageOnContract) {
      res.status(400).json({ message: `${client.name} doesn't include mileage on their contract.` });
      return;
    }
    // The batch route only exists for visit-type billing (St. Luke's).
    if (!client.billsByVisitType) {
      res.status(400).json({
        message: `${client.name} doesn't bill by visit type — just log your time in and out.`,
      });
      return;
    }
    const isWeekend = isWeekendDate(body.date);
    const isHoliday = isHolidayDate(body.date);
    const isDemo = employee.isDemo || client.isDemo;
    const perDiemType = body.perDiemType ?? null;
    const perDiem = perDiemType ? 1 : null;
    // Insert all visit types in one transaction — any failure rolls back everything.
    const rows = await db.transaction(async (tx) => {
      if (isDemo) {
        await tx.execute(sql`select pg_advisory_xact_lock(${DEMO_LOCK_KEY})`);
        const [emp] = await tx.select({ id: employeesTable.id }).from(employeesTable)
          .where(and(eq(employeesTable.id, body.employeeId), eq(employeesTable.active, true)));
        const [cli] = await tx.select({ id: clientsTable.id }).from(clientsTable)
          .where(and(eq(clientsTable.id, body.clientId), eq(clientsTable.active, true)));
        if (!emp || !cli) return null;
      }
      const inserted: TimeEntryRow[] = [];
      for (let i = 0; i < body.visitTypes.length; i++) {
        const vt = body.visitTypes[i]!;
        // Mileage and per diem on first entry only — never double-billed.
        const [row] = await tx
          .insert(timeEntriesTable)
          .values({
            employeeId: body.employeeId,
            employeeName: employee.name,
            employeeRole: employee.role,
            clientId: body.clientId,
            clientName: client.name,
            date: body.date,
            visitType: vt,
            mileage: i === 0 ? (body.mileage ?? null) : null,
            perDiem: i === 0 ? perDiem : null,
            perDiemType: i === 0 ? perDiemType : null,
            isWeekend,
            isHoliday,
            note: body.note ?? null,
            status: body.status ?? "submitted",
            isDemo,
          })
          .returning();
        if (row) inserted.push(row);
      }
      return inserted;
    });
    if (rows === null) {
      res.status(400).json({ message: "Unknown employee or client" });
      return;
    }
    res.status(201).json(rows.map(serialize));
  } catch (err) {
    next(err);
  }
});

// Edit a draft, submitted, or rejected entry. Approved entries are locked.
// Re-runs every create-time rule so an edit can't sneak past validation.
router.patch("/time-entries/:id", async (req, res, next) => {
  try {
    const parsed = UpdateTimeEntryBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid time entry" });
      return;
    }
    const body = parsed.data;
    const numericId = Number(req.params.id);
    if (!Number.isInteger(numericId)) {
      res.status(404).json({ message: "Entry not found" });
      return;
    }
    await ensureRosterSeeded();
    const [existing] = await db
      .select()
      .from(timeEntriesTable)
      .where(eq(timeEntriesTable.id, numericId));
    if (!existing) {
      res.status(404).json({ message: "Entry not found" });
      return;
    }
    // Only the entry's own signed-in employee may edit it. Molly's admin
    // session can't edit entries (that's a separate feature), anonymous
    // requests are refused outright, and another signed-in employee must
    // never even learn the entry exists.
    const admin = await verifyAdminRequest(req);
    if (admin.ok) {
      res.status(403).json({ message: "Entries can only be edited by the employee who logged them." });
      return;
    }
    const session = await resolveSessionEmployee(req);
    if (session.kind === "none") {
      res.status(401).json({ message: "Please sign in first." });
      return;
    }
    if (session.kind === "disabled") {
      res.status(403).json({ code: "SIGN_IN_DISABLED", message: "Your sign-in has been turned off. Ask Molly if you think this is a mistake." });
      return;
    }
    if (session.kind === "pending") {
      res.status(403).json({ code: "LINK_REQUEST_PENDING", message: "Molly still needs to confirm it's you. Check back in a bit." });
      return;
    }
    if (session.kind === "unknown") {
      res.status(403).json({ code: "NOT_LINKED", message: "This email isn't linked to a team profile yet. Pick your name to get set up." });
      return;
    }
    if (session.kind === "employee" && session.employee.id !== existing.employeeId) {
      // Don't reveal whether the entry exists to someone who doesn't own it.
      res.status(404).json({ message: "Entry not found" });
      return;
    }
    if (existing.status === "approved") {
      res.status(400).json({
        message: "This entry has been approved and can no longer be changed. Ask Molly if something's wrong.",
      });
      return;
    }
    // A draft can stay a draft or be submitted; a submitted or rejected entry
    // always comes out of an edit as submitted (an edit is a resubmission).
    if (body.status === "draft" && existing.status !== "draft") {
      res.status(400).json({ message: "A submitted entry can't be turned back into a draft." });
      return;
    }
    const nextStatus =
      existing.status === "draft" ? (body.status ?? "draft") : "submitted";
    const [client] = await db
      .select()
      .from(clientsTable)
      .where(and(eq(clientsTable.id, body.clientId), eq(clientsTable.active, true)));
    if (!client) {
      res.status(400).json({ message: "Unknown client" });
      return;
    }
    if (!isValidDateString(body.date)) {
      res.status(400).json({ message: "That date doesn't exist — please check it" });
      return;
    }
    const hasTimes = body.timeIn != null || body.timeOut != null;
    let hours: number | null = body.hours ?? null;
    if (hasTimes) {
      if (!body.timeIn || !body.timeOut) {
        res.status(400).json({ message: "Enter both a time in and a time out" });
        return;
      }
      const computed = hoursBetween(body.timeIn, body.timeOut);
      if (computed == null || computed <= 0) {
        res.status(400).json({ message: "Those times don't work out to a valid shift" });
        return;
      }
      hours = computed;
    }
    if (!body.visitType && hours == null) {
      res.status(400).json({ message: "Provide a visit type or your time in and out" });
      return;
    }
    if (body.visitType && !client.billsByVisitType) {
      res.status(400).json({
        message: `${client.name} doesn't bill by visit type — just log your time in and out.`,
      });
      return;
    }
    if (body.mileage != null && body.mileage > 0 && !client.mileageOnContract) {
      res.status(400).json({
        message: `${client.name} doesn't include mileage on their contract, so mileage can't be submitted for this client.`,
      });
      return;
    }
    const perDiemType = body.perDiemType ?? null;
    const perDiem = perDiemType ? 1 : (body.perDiem ?? null);
    // Submitting (a draft, or resubmitting after a rejection/edit) stamps a
    // fresh submittedAt so Molly sees when it actually reached her.
    const becameSubmitted = nextStatus === "submitted";
    const [row] = await db
      .update(timeEntriesTable)
      .set({
        clientId: body.clientId,
        clientName: client.name,
        date: body.date,
        visitType: body.visitType ?? null,
        timeIn: hasTimes ? (body.timeIn ?? null) : null,
        timeOut: hasTimes ? (body.timeOut ?? null) : null,
        hours,
        mileage: body.mileage ?? null,
        perDiem,
        perDiemType,
        isWeekend: isWeekendDate(body.date),
        isHoliday: isHolidayDate(body.date),
        note: body.note ?? null,
        status: nextStatus,
        ...(becameSubmitted ? { submittedAt: new Date() } : {}),
        isDemo: existing.isDemo || client.isDemo,
      })
      .where(eq(timeEntriesTable.id, numericId))
      .returning();
    if (!row) {
      res.status(500).json({ message: "Failed to update entry" });
      return;
    }
    res.json(serialize(row));
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
  // Drafts are private to the employee — they can't be approved or rejected,
  // and the approval flow reports them as not found so nothing leaks.
  const [row] = await db
    .update(timeEntriesTable)
    .set({
      status,
      approvedAt: status === "approved" ? new Date() : null,
    })
    .where(and(eq(timeEntriesTable.id, numericId), sql`${timeEntriesTable.status} <> 'draft'`))
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
