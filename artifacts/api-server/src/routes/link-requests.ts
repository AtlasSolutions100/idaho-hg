import { randomUUID } from "node:crypto";
import { Router, type IRouter, type RequestHandler } from "express";
import { and, eq, isNull, notInArray } from "drizzle-orm";
import { getAuth, clerkClient } from "@clerk/express";
import {
  db,
  employeesTable,
  employeeLinkRequestsTable,
  type EmployeeLinkRequestRow,
} from "@workspace/db";
import { CreateLinkRequestBody } from "@workspace/api-zod";
import { ensureRosterSeeded } from "./roster";
import { requireAdmin } from "../lib/employee-auth";
import { getDisciplineKeySet } from "../lib/disciplines";

// Molly's list/approve/deny endpoints use requireAdmin — the same fail-closed
// guard as the sign-in-access toggle: a Clerk session whose verified email
// matches the server-configured ADMIN_EMAIL. Anonymous callers get 401 and a
// claimant's own session can never approve their request.
const router: IRouter = Router();

async function serializeRequest(row: EmployeeLinkRequestRow) {
  const [employee] = await db
    .select()
    .from(employeesTable)
    .where(eq(employeesTable.id, row.employeeId));
  return {
    id: row.id,
    employeeId: row.employeeId,
    employeeName: employee?.name ?? "Unknown",
    employeeRole: employee?.role ?? "",
    email: row.email,
    requestedAt: row.requestedAt.toISOString(),
    // Molly sees this next to the profile's own discipline on the approval
    // card, so a disagreement is visible before she approves.
    ...(row.claimedDiscipline ? { claimedDiscipline: row.claimedDiscipline } : {}),
  };
}

/** Resolve the signed-in Clerk session's normalized email, or null. */
async function sessionEmail(req: Parameters<RequestHandler>[0]): Promise<string | null> {
  const auth = getAuth(req);
  if (!auth?.userId) return null;
  const user = await clerkClient.users.getUser(auth.userId);
  const email =
    user.primaryEmailAddress?.emailAddress ??
    user.emailAddresses[0]?.emailAddress ??
    null;
  return email ? email.trim().toLowerCase() : null;
}

// Roster names a signed-in but unlinked person can claim: active employees
// with no linked email. Requires a session so the list isn't public.
router.get("/link-requests/claimable", async (req, res, next) => {
  try {
    await ensureRosterSeeded();
    const email = await sessionEmail(req);
    if (!email) {
      res.status(401).json({ message: "Please sign in first." });
      return;
    }
    // Active profiles without an email and without a pending claim — a name
    // someone already picked shouldn't be offered to the next person.
    const pending = await db
      .select({ employeeId: employeeLinkRequestsTable.employeeId })
      .from(employeeLinkRequestsTable);
    const pendingIds = pending.map((p) => p.employeeId);
    const rows = await db
      .select()
      .from(employeesTable)
      .where(
        and(
          eq(employeesTable.active, true),
          isNull(employeesTable.email),
          pendingIds.length > 0
            ? notInArray(employeesTable.id, pendingIds)
            : undefined,
        ),
      );
    rows.sort((a, b) => a.name.localeCompare(b.name));
    res.json(rows.map((r) => ({ id: r.id, name: r.name, role: r.role })));
  } catch (err) {
    next(err);
  }
});

// A signed-in person asks to link their email to a roster profile.
router.post("/link-requests", async (req, res, next) => {
  try {
    await ensureRosterSeeded();
    const email = await sessionEmail(req);
    if (!email) {
      res.status(401).json({ message: "Please sign in first." });
      return;
    }
    const parsed = CreateLinkRequestBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ message: parsed.error.issues[0]?.message ?? "Invalid request" });
      return;
    }
    // This email may already belong to a profile — nothing to claim.
    const [linked] = await db
      .select()
      .from(employeesTable)
      .where(eq(employeesTable.email, email));
    if (linked) {
      res.status(409).json({
        message: "This email is already linked to a profile. Try closing and reopening the app.",
      });
      return;
    }
    const [employee] = await db
      .select()
      .from(employeesTable)
      .where(eq(employeesTable.id, parsed.data.employeeId));
    if (!employee || !employee.active) {
      res.status(404).json({ message: "That team member wasn't found." });
      return;
    }
    if (employee.email) {
      res.status(409).json({
        message: `${employee.name}'s profile already has a sign-in email. If that's you, ask Molly.`,
      });
      return;
    }
    // One pending claim per email: if they already asked, return the
    // existing request (even if they picked a different name — first pick
    // stands until Molly decides or they ask her directly).
    const [existing] = await db
      .select()
      .from(employeeLinkRequestsTable)
      .where(eq(employeeLinkRequestsTable.email, email));
    if (existing) {
      res.status(201).json(await serializeRequest(existing));
      return;
    }
    // One pending claim per profile: if someone else already picked this
    // name, the second claimant gets a clear conflict instead of leaving
    // Molly with competing requests.
    const [claimed] = await db
      .select()
      .from(employeeLinkRequestsTable)
      .where(eq(employeeLinkRequestsTable.employeeId, employee.id));
    if (claimed) {
      res.status(409).json({
        message: `Someone already asked to be linked to ${employee.name}. If that's really you, ask Molly.`,
      });
      return;
    }
    // The discipline they picked for themselves. Recorded on the request, not
    // written to the profile: Molly approves the person and their profession
    // in one step, so a wrong pick can't silently re-rate anyone.
    let claimedDiscipline: string | null = null;
    if (parsed.data.discipline) {
      const picked = parsed.data.discipline.trim();
      if (!(await getDisciplineKeySet()).has(picked)) {
        res.status(400).json({ message: `"${picked}" isn't one of the listed disciplines.` });
        return;
      }
      claimedDiscipline = picked;
    }
    try {
      const [row] = await db
        .insert(employeeLinkRequestsTable)
        .values({ id: randomUUID(), employeeId: employee.id, email, claimedDiscipline })
        .returning();
      res.status(201).json(await serializeRequest(row));
    } catch (err) {
      // Unique races: this email already claimed something (return it), or
      // someone else claimed this profile first (conflict).
      const [racedEmail] = await db
        .select()
        .from(employeeLinkRequestsTable)
        .where(eq(employeeLinkRequestsTable.email, email));
      if (racedEmail) {
        res.status(201).json(await serializeRequest(racedEmail));
        return;
      }
      const [racedProfile] = await db
        .select()
        .from(employeeLinkRequestsTable)
        .where(eq(employeeLinkRequestsTable.employeeId, employee.id));
      if (racedProfile) {
        res.status(409).json({
          message: `Someone already asked to be linked to ${employee.name}. If that's really you, ask Molly.`,
        });
        return;
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

// Cancel my own pending request ("That's not me — pick again"). Scoped to the
// session's verified email, so nobody can cancel anyone else's request, and
// Molly's approve/deny flow is untouched. A concurrent approve holds the row
// lock and deletes it on commit, so this then matches zero rows and reports
// "already handled" instead of silently unlinking an approved profile.
router.delete("/link-requests/mine", async (req, res, next) => {
  try {
    const email = await sessionEmail(req);
    if (!email) {
      res.status(401).json({ message: "Please sign in first." });
      return;
    }
    const [row] = await db
      .delete(employeeLinkRequestsTable)
      .where(eq(employeeLinkRequestsTable.email, email))
      .returning();
    if (!row) {
      res.status(404).json({
        message: "No pending request found. It may have already been handled.",
      });
      return;
    }
    res.json(await serializeRequest(row));
  } catch (err) {
    next(err);
  }
});

// Pending requests for Molly's admin page.
router.get("/link-requests", requireAdmin, async (_req, res, next) => {
  try {
    await ensureRosterSeeded();
    const rows = await db.select().from(employeeLinkRequestsTable);
    rows.sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime());
    res.json(await Promise.all(rows.map(serializeRequest)));
  } catch (err) {
    next(err);
  }
});

// Approve: attach the email to the profile and remove the request. Runs in a
// transaction with a fresh re-check so a profile linked in the meantime (or a
// concurrent approval) can't end up with conflicting emails.
router.post(
  "/link-requests/:id/approve",
  requireAdmin,
  async (req, res, next) => {
    try {
      await ensureRosterSeeded();
      const id = String(req.params.id);
      const outcome = await db.transaction(async (tx) => {
        // Peek at the request without locking to learn the employee id
        // (requests are never updated, only inserted/deleted).
        const [peek] = await tx
          .select()
          .from(employeeLinkRequestsTable)
          .where(eq(employeeLinkRequestsTable.id, id));
        if (!peek) return { status: 404 as const };
        // Lock employee BEFORE the request row — the manual email edit
        // (PATCH /employees/:id) locks in the same order, so the two can
        // never deadlock.
        const [employee] = await tx
          .select()
          .from(employeesTable)
          .where(eq(employeesTable.id, peek.employeeId))
          .for("update");
        const [request] = await tx
          .select()
          .from(employeeLinkRequestsTable)
          .where(eq(employeeLinkRequestsTable.id, id))
          .for("update");
        // The request may have been denied/cleared while we waited.
        if (!request) return { status: 404 as const };
        if (!employee || !employee.active) {
          // Profile disappeared — drop the stale request.
          await tx
            .delete(employeeLinkRequestsTable)
            .where(eq(employeeLinkRequestsTable.id, id));
          return {
            status: 409 as const,
            message: "That team member is no longer on the roster.",
          };
        }
        if (employee.email) {
          await tx
            .delete(employeeLinkRequestsTable)
            .where(eq(employeeLinkRequestsTable.id, id));
          return {
            status: 409 as const,
            message: `${employee.name}'s profile already has a sign-in email.`,
          };
        }
        const [emailTaken] = await tx
          .select()
          .from(employeesTable)
          .where(eq(employeesTable.email, request.email));
        if (emailTaken) {
          await tx
            .delete(employeeLinkRequestsTable)
            .where(eq(employeeLinkRequestsTable.id, id));
          return {
            status: 409 as const,
            message: `That email is already used by ${emailTaken.name}.`,
          };
        }
        // Conditional on email still being NULL — belt-and-braces against
        // any writer that didn't take the row lock.
        // Approving accepts both the identity and the discipline they stated.
        // Molly saw both on the card; if the discipline is wrong she denies,
        // or fixes it afterwards on the employee.
        const [updated] = await tx
          .update(employeesTable)
          .set({
            email: request.email,
            ...(request.claimedDiscipline ? { role: request.claimedDiscipline } : {}),
          })
          .where(and(eq(employeesTable.id, employee.id), isNull(employeesTable.email)))
          .returning();
        if (!updated) {
          await tx
            .delete(employeeLinkRequestsTable)
            .where(eq(employeeLinkRequestsTable.id, id));
          return {
            status: 409 as const,
            message: `${employee.name}'s profile already has a sign-in email.`,
          };
        }
        await tx
          .delete(employeeLinkRequestsTable)
          .where(eq(employeeLinkRequestsTable.id, id));
        return { status: 200 as const, employee: updated };
      });
      if (outcome.status === 404) {
        res.status(404).json({ message: "That request wasn't found. It may have already been handled." });
        return;
      }
      if (outcome.status === 409) {
        res.status(409).json({ message: outcome.message });
        return;
      }
      const row = outcome.employee;
      res.json({
        id: row.id,
        name: row.name,
        role: row.role,
        active: row.active,
        isDemo: row.isDemo,
        ...(row.email ? { email: row.email } : {}),
        signInEnabled: row.signInEnabled,
      });
    } catch (err) {
      next(err);
    }
  },
);

// Deny: remove the request; the person stays blocked and can ask Molly.
router.post(
  "/link-requests/:id/deny",
  requireAdmin,
  async (req, res, next) => {
    try {
      await ensureRosterSeeded();
      const id = String(req.params.id);
      // Atomic claim: the conditional delete either wins the row or returns
      // nothing. A concurrent approve holds the row lock and deletes it on
      // commit, so deny then sees zero rows and reports "already handled"
      // instead of a false "denied".
      const [row] = await db
        .delete(employeeLinkRequestsTable)
        .where(eq(employeeLinkRequestsTable.id, id))
        .returning();
      if (!row) {
        res.status(404).json({ message: "That request wasn't found. It may have already been handled." });
        return;
      }
      res.json(await serializeRequest(row));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
