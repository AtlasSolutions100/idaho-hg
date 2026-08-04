import type { NextFunction, Request, Response } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import { db, employeesTable, type EmployeeRow } from "@workspace/db";
import { ensureRosterSeeded } from "../routes/roster";

/**
 * Look up the signed-in Clerk user's email and map it to a roster employee.
 *
 * Returns one of:
 * - { kind: "none" }        — no Clerk session on the request
 * - { kind: "unknown" }     — signed in, but email is not on the roster
 * - { kind: "employee" }    — signed in and matched to an active employee
 */
export async function resolveSessionEmployee(
  req: Request,
): Promise<
  | { kind: "none" }
  | { kind: "unknown"; email: string | null }
  | { kind: "employee"; employee: EmployeeRow; email: string }
> {
  const auth = getAuth(req);
  if (!auth?.userId) return { kind: "none" };

  const user = await clerkClient.users.getUser(auth.userId);
  const email =
    user.primaryEmailAddress?.emailAddress ??
    user.emailAddresses[0]?.emailAddress ??
    null;
  if (!email) return { kind: "unknown", email: null };

  // Guarantee the roster exists before mapping the session to an employee —
  // on a fresh database a signed-in employee must not be told they're
  // missing from the roster just because seeding hasn't run yet.
  await ensureRosterSeeded();

  const normalized = email.trim().toLowerCase();
  const [employee] = await db
    .select()
    .from(employeesTable)
    .where(eq(employeesTable.email, normalized));
  if (!employee || !employee.active) {
    return { kind: "unknown", email: normalized };
  }
  return { kind: "employee", employee, email: normalized };
}

/** Express middleware: require a signed-in user who is on the roster. */
export async function requireEmployee(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const session = await resolveSessionEmployee(req);
    if (session.kind === "none") {
      res.status(401).json({ message: "Please sign in first." });
      return;
    }
    if (session.kind === "unknown") {
      res.status(403).json({
        message:
          "This email isn't on the team roster yet. Ask Molly to add your email, then try again.",
      });
      return;
    }
    (req as Request & { employee: EmployeeRow }).employee = session.employee;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Make sure a Clerk account exists for this email so the employee can sign in
 * with a one-time code (no sign-up step in the app). Idempotent.
 */
export async function ensureClerkUserForEmail(email: string): Promise<void> {
  const existing = await clerkClient.users.getUserList({
    emailAddress: [email],
  });
  if (existing.data.length > 0) return;
  await clerkClient.users.createUser({
    emailAddress: [email],
    skipPasswordRequirement: true,
  });
}
