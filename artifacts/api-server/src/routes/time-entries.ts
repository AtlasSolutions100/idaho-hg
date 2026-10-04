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
  PriceTimeEntryBody,
  UpdateTimeEntryBody,
} from "@workspace/api-zod";
import {
  requireAdmin,
  resolveCaller,
  resolveSessionEmployee,
  verifyAdminRequest,
} from "../lib/employee-auth";
import { getVisitTypeMap } from "../lib/visit-types";
import {
  hoursBetween,
  isHolidayDate,
  isValidDateString,
  isWeekendDate,
} from "../lib/work-calendar";
import { normalizeHourKind } from "../lib/hour-kinds";

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
    ...(row.endDate ? { endDate: row.endDate } : {}),
    ...(row.visitType ? { visitType: row.visitType } : {}),
    ...(row.hourKind && row.hourKind !== "regular"
      ? { hourKind: row.hourKind as "on-call" | "call-back" }
      : {}),
    ...(row.travelLocation ? { travelLocation: row.travelLocation } : {}),
    quantity: row.quantity,
    ...(row.timeIn ? { timeIn: row.timeIn } : {}),
    ...(row.timeOut ? { timeOut: row.timeOut } : {}),
    ...(row.hours != null ? { hours: row.hours } : {}),
    ...(row.mileage != null ? { mileage: row.mileage } : {}),
    ...(row.perDiem != null ? { perDiem: row.perDiem } : {}),
    ...(row.perDiemType ? { perDiemType: row.perDiemType } : {}),
    isWeekend: row.isWeekend,
    isHoliday: row.isHoliday,
    ...(row.note ? { note: row.note } : {}),
    ...(row.isOther ? { isOther: true } : {}),
    ...(row.customPayAmount != null ? { customPayAmount: row.customPayAmount } : {}),
    ...(row.customBillAmount != null ? { customBillAmount: row.customBillAmount } : {}),
    status: row.status,
    isDemo: row.isDemo,
    submittedAt: row.submittedAt.toISOString(),
    ...(row.approvedAt ? { approvedAt: row.approvedAt.toISOString() } : {}),
    ...(row.adminEditedAt ? { adminEditedAt: row.adminEditedAt.toISOString() } : {}),
    ...(row.adminEditSummary ? { adminEditSummary: row.adminEditSummary } : {}),
  };
}

// Human-readable "what Molly changed" summary for the employee's audit
// trail, e.g. `Mileage: 12 → 20; Note: "typo" → "fixed"`. Returns null when
// nothing actually changed so a no-op save leaves no trail.
export function summarizeAdminChanges(
  existing: TimeEntryRow,
  next: {
    clientName: string;
    date: string;
    endDate: string | null;
    visitType: string | null;
    quantity: number;
    timeIn: string | null;
    timeOut: string | null;
    hours: number | null;
    mileage: number | null;
    perDiem: number | null;
    perDiemType: string | null;
    note: string | null;
  },
): string | null {
  const show = (v: string | number | null | undefined) =>
    v == null || v === "" ? "none" : String(v);
  const changes: string[] = [];
  const compare = (
    label: string,
    before: string | number | null | undefined,
    after: string | number | null | undefined,
  ) => {
    if ((before ?? null) !== (after ?? null)) {
      changes.push(`${label}: ${show(before)} → ${show(after)}`);
    }
  };
  compare("Client", existing.clientName, next.clientName);
  compare("Date", existing.date, next.date);
  compare("Through", existing.endDate, next.endDate);
  compare("Visit type", existing.visitType, next.visitType);
  compare("How many", existing.quantity, next.quantity);
  // Clock times move together — report them as one change.
  if (existing.timeIn !== next.timeIn || existing.timeOut !== next.timeOut) {
    const before =
      existing.timeIn && existing.timeOut ? `${existing.timeIn}–${existing.timeOut}` : null;
    const after = next.timeIn && next.timeOut ? `${next.timeIn}–${next.timeOut}` : null;
    changes.push(`Times: ${show(before)} → ${show(after)}`);
  }
  compare("Hours", existing.hours, next.hours);
  compare("Mileage", existing.mileage, next.mileage);
  if (existing.perDiemType !== next.perDiemType || (existing.perDiem ?? null) !== (next.perDiem ?? null)) {
    const label = (t: string | null, n: number | null) =>
      t === "first_last" ? "First/Last day" : t === "full" ? "Full day" : n != null && n > 0 ? String(n) : "none";
    changes.push(
      `Per diem: ${label(existing.perDiemType, existing.perDiem)} → ${label(next.perDiemType, next.perDiem)}`,
    );
  }
  if ((existing.note ?? null) !== (next.note ?? null)) {
    changes.push(`Note: ${existing.note ? `"${existing.note}"` : "none"} → ${next.note ? `"${next.note}"` : "none"}`);
  }
  return changes.length > 0 ? changes.join("; ") : null;
}

/**
 * Validate how many of a visit type an entry covers.
 *
 * Quantity carries two related things Molly asked for: the same visit more
 * than once in a day (two evals and a discharge), and, for a type billed in
 * blocks rather than per visit, how many blocks (a half hour of a 15-minute
 * type is 2). Both are counts, so both are whole numbers — there is no half
 * an eval and no third of a 15-minute block.
 */
export function validateQuantity(
  raw: number | undefined,
  visitType: string | null,
  visitTypeRow: { label: string; billingUnit: string; incrementMinutes: number } | undefined,
): { quantity: number } | { error: string } {
  if (raw == null) return { quantity: 1 };
  if (!visitType) {
    // Hourly, mileage and Other entries are measured by their own fields
    // (hours, miles, a flat amount). A quantity here would not be applied to
    // anything, so accepting it silently would be a lie.
    return raw === 1
      ? { quantity: 1 }
      : { error: "How many only applies to visit entries." };
  }
  if (!Number.isInteger(raw) || raw < 1 || raw > 100) {
    const unit =
      visitTypeRow?.billingUnit === "increment"
        ? `${visitTypeRow.incrementMinutes}-minute blocks`
        : "visits";
    return { error: `Enter a whole number of ${unit} (1 to 100).` };
  }
  return { quantity: raw };
}

/**
 * Validate the optional end of a date range.
 *
 * Only a mileage-only entry may span days: St. Luke's employees pull a
 * mileage report off the client's device for a whole pay period and enter one
 * total, so the entry covers date..endDate. Everything else happens on a
 * single day — a visit, a shift, a per-diem day — and spreading one across a
 * range would make it impossible to say which day it was worked.
 */
export function validateEndDate(
  endDate: string | undefined,
  shape: {
    date: string;
    visitType: string | null;
    hours: number | null;
    perDiem: number | null;
    mileage: number | null;
    isOther: boolean;
  },
): { endDate: string | null } | { error: string } {
  if (endDate == null || endDate === "") return { endDate: null };
  const mileageOnly =
    !shape.visitType &&
    shape.hours == null &&
    !shape.isOther &&
    (shape.perDiem ?? 0) === 0 &&
    (shape.mileage ?? 0) > 0;
  if (!mileageOnly) {
    return {
      error:
        "Only a mileage entry can cover a date range. Log visits and shifts on the day they happened.",
    };
  }
  if (!isValidDateString(endDate)) {
    return { error: "That end date doesn't exist — please check it" };
  }
  if (endDate < shape.date) {
    return { error: "The end of the range can't be before the start." };
  }
  return { endDate };
}

router.get("/time-entries", async (req, res, next) => {
  try {
    const query = ListTimeEntriesQueryParams.parse(req.query);
    // Everyone's hours, mileage and per diem live behind this endpoint, so a
    // session is required: no session is a 401, not an unfiltered read.
    // Molly (the verified admin sign-in) sees everything — her email isn't a
    // roster profile, so without the admin arm she'd be turned away as
    // "not linked" and the payroll page would show nothing. An employee only
    // ever sees their own entries, whatever filter the client sent.
    const resolved = await resolveCaller(req);
    if (!resolved.ok) {
      res.status(resolved.status).json(resolved.body);
      return;
    }
    const caller = resolved.caller;
    if (caller.kind === "employee") {
      query.employeeId = caller.employee.id;
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
    if (caller.kind !== "employee") {
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
// for a client that employees are actively logging visits against. Admin-only:
// it is read from her client settings dialog and nowhere else, and a count of
// a client’s visits is business volume nobody outside should be able to poll.
router.get("/clients/:id/visit-entry-count", requireAdmin, async (req, res, next) => {
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
router.get("/clients/:id/hourly-entry-count", requireAdmin, async (req, res, next) => {
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
    // Filing hours under someone else's name is a payroll problem, so the
    // entry is always recorded against the signed-in employee — the client
    // can't pick another. Molly may name any employee, because she enters
    // hours for people who forgot; nobody else gets to.
    const resolved = await resolveCaller(req);
    if (!resolved.ok) {
      res.status(resolved.status).json(resolved.body);
      return;
    }
    const caller = resolved.caller;
    // Drafts are private to their author, which only means something for a
    // signed-in employee — Molly can't see or finish someone's draft.
    if (body.status === "draft" && caller.kind !== "employee") {
      res.status(400).json({ message: "Only the employee can save their own draft." });
      return;
    }
    if (caller.kind === "employee") {
      body.employeeId = caller.employee.id;
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
    // "Other" one-offs (training, meetings, professional development):
    // a required description plus time worked. No visit type or per diem —
    // pay is a flat amount Molly sets while reviewing.
    const isOther = body.isOther === true;
    if (isOther) {
      if (body.visitType) {
        res.status(400).json({ message: "An Other entry doesn't use a visit type — describe the work in the note instead." });
        return;
      }
      if (body.perDiemType || (body.perDiem != null && body.perDiem > 0)) {
        res.status(400).json({ message: "Per diem doesn't apply to Other entries." });
        return;
      }
      if (!body.note?.trim()) {
        res.status(400).json({ message: 'Describe what this was — for example "3 hours professional development at Weiser School District".' });
        return;
      }
      if (hours == null) {
        res.status(400).json({ message: "Enter your time in and out (or hours) for this entry" });
        return;
      }
    }
    // A mileage-only entry is a valid shape on its own: St. Luke's employees
    // report mileage for a whole period from the client's device, with no
    // visit and no shift attached to it.
    const mileageOnly = !body.visitType && hours == null && (body.mileage ?? 0) > 0 && !isOther;
    if (!body.visitType && hours == null && !mileageOnly) {
      res.status(400).json({ message: "Provide a visit type, your time in and out, or mileage" });
      return;
    }
    // A travel allowance stands in for mileage, so an entry can't claim both.
    const travelLocation = body.travelLocation?.trim() || null;
    if (travelLocation && (body.mileage ?? 0) > 0) {
      res.status(400).json({
        message:
          "That location pays a travel allowance instead of mileage — leave the miles blank.",
      });
      return;
    }
    // On call and call back describe hours worked, so they make no sense on
    // a visit entry, a mileage-only entry or a one-off.
    const hourKind = normalizeHourKind(body.hourKind);
    if (hourKind !== "regular" && (body.visitType || isOther || hours == null)) {
      res.status(400).json({
        message:
          "On call and call back apply to hours — enter your time in and out.",
      });
      return;
    }
    // Visit types only apply to clients that bill by visit type (St. Luke's).
    if (body.visitType && !client.billsByVisitType) {
      res.status(400).json({
        message: `${client.name} doesn't bill by visit type — just log your time in and out.`,
      });
      return;
    }
    // Visit type must exist in the admin-managed catalog (the enum is now open).
    const visitTypeMap = await getVisitTypeMap();
    if (body.visitType && !visitTypeMap.has(body.visitType)) {
      res.status(400).json({ message: `Unknown visit type "${body.visitType}".` });
      return;
    }
    const qty = validateQuantity(
      body.quantity,
      body.visitType ?? null,
      body.visitType ? visitTypeMap.get(body.visitType) : undefined,
    );
    if ("error" in qty) {
      res.status(400).json({ message: qty.error });
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
    const range = validateEndDate(body.endDate, {
      date: body.date,
      visitType: body.visitType ?? null,
      hours,
      perDiem,
      mileage: body.mileage ?? null,
      isOther,
    });
    if ("error" in range) {
      res.status(400).json({ message: range.error });
      return;
    }
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
          endDate: range.endDate,
          visitType: body.visitType ?? null,
          hourKind: hourKind === "regular" ? null : hourKind,
          travelLocation,
          quantity: qty.quantity,
          timeIn: hasTimes ? (body.timeIn ?? null) : null,
          timeOut: hasTimes ? (body.timeOut ?? null) : null,
          hours,
          mileage: body.mileage ?? null,
          perDiem,
          perDiemType,
          isOther,
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
    // Same gate as the single-entry route.
    const resolved = await resolveCaller(req);
    if (!resolved.ok) {
      res.status(resolved.status).json(resolved.body);
      return;
    }
    const caller = resolved.caller;
    if (body.status === "draft" && caller.kind !== "employee") {
      res.status(400).json({ message: "Only the employee can save their own draft." });
      return;
    }
    if (caller.kind === "employee") {
      body.employeeId = caller.employee.id;
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
    // Two accepted shapes: `visits` (each line with its own quantity) and the
    // older `visitTypes` (a plain list of keys, one each). Normalize to one
    // list so everything below has a single thing to work with.
    if (body.visits && body.visitTypes) {
      res.status(400).json({ message: "Send either visits or visitTypes, not both." });
      return;
    }
    const lines: Array<{ visitType: string; quantity?: number }> =
      body.visits ?? (body.visitTypes ?? []).map((vt) => ({ visitType: vt }));
    if (lines.length === 0) {
      res.status(400).json({ message: "Pick at least one visit." });
      return;
    }
    // All visit types must exist in the admin-managed catalog (open enum).
    const visitTypeMap = await getVisitTypeMap();
    const resolvedLines: Array<{ visitType: string; quantity: number }> = [];
    for (const line of lines) {
      const row = visitTypeMap.get(line.visitType);
      if (!row) {
        res.status(400).json({ message: `Unknown visit type "${line.visitType}".` });
        return;
      }
      const qty = validateQuantity(line.quantity, line.visitType, row);
      if ("error" in qty) {
        res.status(400).json({ message: `${row.label}: ${qty.error}` });
        return;
      }
      resolvedLines.push({ visitType: line.visitType, quantity: qty.quantity });
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
      for (let i = 0; i < resolvedLines.length; i++) {
        const line = resolvedLines[i]!;
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
            visitType: line.visitType,
            quantity: line.quantity,
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
    // Who may edit: the entry's own signed-in employee, or Molly's verified
    // admin session (so she can fix a typo before approving instead of
    // rejecting and waiting). Anonymous requests are refused outright, and
    // another signed-in employee must never even learn the entry exists.
    const admin = await verifyAdminRequest(req);
    const isAdminEdit = admin.ok;
    if (isAdminEdit) {
      // Drafts are private to their author — Molly never sees them in lists,
      // so an admin edit against a draft id must not reveal it exists.
      if (existing.status === "draft") {
        res.status(404).json({ message: "Entry not found" });
        return;
      }
    } else {
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
    }
    if (existing.status === "approved") {
      res.status(400).json({
        message: "This entry has been approved and can no longer be changed. Ask Molly if something's wrong.",
      });
      return;
    }
    // A draft can stay a draft or be submitted; a submitted or rejected entry
    // always comes out of an edit as submitted (an edit is a resubmission).
    // An admin edit is a correction, not a resubmission — the entry keeps its
    // current status and its original submittedAt.
    if (body.status === "draft" && existing.status !== "draft") {
      res.status(400).json({ message: "A submitted entry can't be turned back into a draft." });
      return;
    }
    const nextStatus = isAdminEdit
      ? existing.status
      : existing.status === "draft"
        ? (body.status ?? "draft")
        : "submitted";
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
    // An entry never changes kind: "Other" one-offs stay Other, normal
    // entries can't become Other. Same rules as creation apply.
    const isOther = existing.isOther;
    if (isOther) {
      if (body.visitType) {
        res.status(400).json({ message: "An Other entry doesn't use a visit type — describe the work in the note instead." });
        return;
      }
      if (body.perDiemType || (body.perDiem != null && body.perDiem > 0)) {
        res.status(400).json({ message: "Per diem doesn't apply to Other entries." });
        return;
      }
      if (!body.note?.trim()) {
        res.status(400).json({ message: 'Describe what this was — for example "3 hours professional development at Weiser School District".' });
        return;
      }
      if (hours == null) {
        res.status(400).json({ message: "Enter your time in and out (or hours) for this entry" });
        return;
      }
    }
    const mileageOnly = !body.visitType && hours == null && (body.mileage ?? 0) > 0 && !isOther;
    if (!body.visitType && hours == null && !mileageOnly) {
      res.status(400).json({ message: "Provide a visit type, your time in and out, or mileage" });
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
    // An edit re-runs every create-time rule, including the catalog check:
    // a type Molly retired can't be introduced by editing an old entry.
    const visitTypeMap = await getVisitTypeMap();
    if (body.visitType && !visitTypeMap.has(body.visitType)) {
      res.status(400).json({ message: `Unknown visit type "${body.visitType}".` });
      return;
    }
    const qty = validateQuantity(
      body.quantity,
      body.visitType ?? null,
      body.visitType ? visitTypeMap.get(body.visitType) : undefined,
    );
    if ("error" in qty) {
      res.status(400).json({ message: qty.error });
      return;
    }
    const perDiemType = body.perDiemType ?? null;
    const perDiem = perDiemType ? 1 : (body.perDiem ?? null);
    const range = validateEndDate(body.endDate, {
      date: body.date,
      visitType: body.visitType ?? null,
      hours,
      perDiem,
      mileage: body.mileage ?? null,
      isOther,
    });
    if ("error" in range) {
      res.status(400).json({ message: range.error });
      return;
    }
    // Submitting (a draft, or resubmitting after a rejection/edit) stamps a
    // fresh submittedAt so Molly sees when it actually reached her. Admin
    // corrections never restamp it — the employee's submission time stands.
    const becameSubmitted = !isAdminEdit && nextStatus === "submitted";
    // Audit trail for admin edits: a human-readable list of what Molly
    // changed, shown to the employee in their apps.
    const adminEditSummary = isAdminEdit
      ? summarizeAdminChanges(existing, {
          clientName: client.name,
          date: body.date,
          endDate: range.endDate,
          visitType: body.visitType ?? null,
          quantity: qty.quantity,
          timeIn: hasTimes ? (body.timeIn ?? null) : null,
          timeOut: hasTimes ? (body.timeOut ?? null) : null,
          hours,
          mileage: body.mileage ?? null,
          perDiem,
          perDiemType,
          note: body.note ?? null,
        })
      : null;
    const [row] = await db
      .update(timeEntriesTable)
      .set({
        clientId: body.clientId,
        clientName: client.name,
        date: body.date,
        endDate: range.endDate,
        visitType: body.visitType ?? null,
        hourKind:
          body.hourKind === undefined
            ? existing.hourKind
            : normalizeHourKind(body.hourKind) === "regular"
              ? null
              : normalizeHourKind(body.hourKind),
        quantity: qty.quantity,
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
        // Only stamp the audit trail when the admin actually changed
        // something; a no-op save shouldn't tell the employee "Molly
        // adjusted this".
        ...(isAdminEdit && adminEditSummary
          ? { adminEditedAt: new Date(), adminEditSummary }
          : {}),
        // An employee edit of a priced Other entry invalidates the price —
        // the work may have changed, so Molly must set the amount again.
        // Admin corrections keep the pricing she already entered.
        ...(isOther && !isAdminEdit
          ? { customPayAmount: null, customBillAmount: null }
          : {}),
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

// Molly sets the flat pay (and optional client billing) amount for an
// "Other" one-off while reviewing. Admin only; drafts stay invisible and
// approved entries are locked, matching the edit rules.
router.post("/time-entries/:id/price", async (req, res, next) => {
  try {
    const parsed = PriceTimeEntryBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid amounts" });
      return;
    }
    const body = parsed.data;
    const admin = await verifyAdminRequest(req);
    if (!admin.ok) {
      res.status(admin.status).json({ message: admin.message });
      return;
    }
    const numericId = Number(req.params.id);
    if (!Number.isInteger(numericId)) {
      res.status(404).json({ message: "Entry not found" });
      return;
    }
    const [existing] = await db
      .select()
      .from(timeEntriesTable)
      .where(eq(timeEntriesTable.id, numericId));
    if (!existing || existing.status === "draft") {
      res.status(404).json({ message: "Entry not found" });
      return;
    }
    if (!existing.isOther) {
      res.status(400).json({ message: "Only Other one-off entries take a custom amount — normal entries pay from the rate tables." });
      return;
    }
    if (existing.status === "approved") {
      res.status(400).json({ message: "This entry has been approved and can no longer be changed." });
      return;
    }
    const [row] = await db
      .update(timeEntriesTable)
      .set({
        customPayAmount: body.customPayAmount ?? null,
        customBillAmount: body.customBillAmount ?? null,
      })
      .where(eq(timeEntriesTable.id, numericId))
      .returning();
    if (!row) {
      res.status(404).json({ message: "Entry not found" });
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
    // Approving locks an entry and feeds payroll/invoices — admin only.
    const admin = await verifyAdminRequest(req);
    if (!admin.ok) {
      res.status(admin.status).json({ message: admin.message });
      return;
    }
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
    // Only Molly reviews and rejects employees' entries — admin only.
    const admin = await verifyAdminRequest(req);
    if (!admin.ok) {
      res.status(admin.status).json({ message: admin.message });
      return;
    }
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

router.post("/time-entries/approve-all", async (req, res, next) => {
  try {
    // Bulk-approves the whole submitted queue — admin only.
    const admin = await verifyAdminRequest(req);
    if (!admin.ok) {
      res.status(admin.status).json({ message: admin.message });
      return;
    }
    // Unpriced "Other" one-offs are skipped: approving locks the entry, and
    // a locked entry with no pay amount could never be priced. Molly sets
    // the amount first, then approves.
    const rows = await db
      .update(timeEntriesTable)
      .set({ status: "approved", approvedAt: new Date() })
      .where(
        and(
          eq(timeEntriesTable.status, "submitted"),
          sql`not (${timeEntriesTable.isOther} and ${timeEntriesTable.customPayAmount} is null)`,
        ),
      )
      .returning();
    const [skipped] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(timeEntriesTable)
      .where(
        and(
          eq(timeEntriesTable.status, "submitted"),
          eq(timeEntriesTable.isOther, true),
          sql`${timeEntriesTable.customPayAmount} is null`,
        ),
      );
    res.json({ approvedCount: rows.length, skippedUnpricedOtherCount: skipped?.count ?? 0 });
  } catch (err) {
    next(err);
  }
});

export default router;
