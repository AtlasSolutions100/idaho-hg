import type { NextFunction, Request, RequestHandler, Response } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import {
  db,
  employeesTable,
  employeeLinkRequestsTable,
  type EmployeeRow,
} from "@workspace/db";
import { ensureRosterSeeded } from "../routes/roster";

/**
 * Look up the signed-in Clerk user's email and map it to a roster employee.
 *
 * Returns one of:
 * - { kind: "none" }        — no Clerk session on the request
 * - { kind: "unknown" }     — signed in, but email is not on the roster
 * - { kind: "pending" }     — signed in; asked to link a profile, waiting on Molly
 * - { kind: "disabled" }    — on the roster, but Molly turned sign-in off
 * - { kind: "employee" }    — signed in and matched to an active employee
 */
export async function resolveSessionEmployee(
  req: Request,
): Promise<
  | { kind: "none" }
  | { kind: "unknown"; email: string | null }
  | { kind: "pending"; email: string }
  | { kind: "disabled"; email: string }
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
    // Not linked to a profile — but they may already have asked Molly to
    // link them, in which case the apps show a "waiting" screen instead of
    // the pick-your-name flow.
    const [pending] = await db
      .select()
      .from(employeeLinkRequestsTable)
      .where(eq(employeeLinkRequestsTable.email, normalized));
    if (pending) {
      return { kind: "pending", email: normalized };
    }
    return { kind: "unknown", email: normalized };
  }
  if (!employee.signInEnabled) {
    return { kind: "disabled", email: normalized };
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
    if (session.kind === "disabled") {
      res.status(403).json({
        // Stable code so clients can branch without matching on wording.
        code: "SIGN_IN_DISABLED",
        message:
          "Your sign-in has been turned off. Ask Molly if you think this is a mistake.",
      });
      return;
    }
    if (session.kind === "pending") {
      res.status(403).json({
        code: "LINK_REQUEST_PENDING",
        message:
          "Molly still needs to confirm it's you. Check back in a bit.",
      });
      return;
    }
    if (session.kind === "unknown") {
      res.status(403).json({
        code: "NOT_LINKED",
        message:
          "This email isn't linked to a team profile yet. Pick your name to get set up.",
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
 * Express middleware: require any signed-in Clerk session (not necessarily
 * on the roster). Used for reads that must not be public — e.g. the employee
 * list, which the mobile claim-your-name flow needs before the caller is
 * linked to a roster profile.
 */
export const requireSignedIn: RequestHandler = (req, res, next) => {
  const auth = getAuth(req);
  if (!auth?.userId) {
    res.status(401).json({ message: "Please sign in first." });
    return;
  }
  next();
};

/**
 * The admin (Molly's) sign-in email, from server configuration. Admin
 * identity is deliberately NOT stored on the roster: roster rows (including
 * emails) are mutable through the API, so a row-based admin flag would let
 * anyone assign themselves the admin email and escalate. An environment
 * variable can only be changed by whoever operates the server.
 */
export function getConfiguredAdminEmail(): string | null {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  return email || null;
}

/**
 * Express middleware: require a Clerk session whose verified email matches
 * the configured admin email (Molly). No session → 401. Any other session —
 * employee, unknown, or Molly-unconfigured — → 403. Fails closed when
 * ADMIN_EMAIL is not configured.
 */
export async function verifyAdminRequest(
  req: Request,
): Promise<{ ok: true } | { ok: false; status: 401 | 403; message: string }> {
  const auth = getAuth(req);
  if (!auth?.userId) {
    return { ok: false, status: 401, message: "Please sign in first." };
  }
  const adminEmail = getConfiguredAdminEmail();
  if (!adminEmail) {
    // Fail closed: without a configured admin, nobody is the admin.
    return {
      ok: false,
      status: 403,
      message: "Admin access isn't set up yet, so this can't be changed.",
    };
  }
  // Compare against the Clerk-verified session email — never anything the
  // caller supplies or anything stored in the mutable roster.
  const user = await clerkClient.users.getUser(auth.userId);
  const email = (
    user.primaryEmailAddress?.emailAddress ??
    user.emailAddresses[0]?.emailAddress ??
    ""
  )
    .trim()
    .toLowerCase();
  if (!email || email !== adminEmail) {
    return { ok: false, status: 403, message: "Only Molly can make this change." };
  }
  return { ok: true };
}

export const requireAdmin: RequestHandler = async (req, res, next) => {
  try {
    const verdict = await verifyAdminRequest(req);
    if (!verdict.ok) {
      res.status(verdict.status).json({ message: verdict.message });
      return;
    }
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

/**
 * Revoke all active Clerk sessions for the user(s) matching this email, so a
 * disabled employee is signed out of the app immediately instead of only
 * being blocked per-request. Best-effort: any Clerk failure is logged and
 * swallowed — the server-side SIGN_IN_DISABLED block already guarantees no
 * access either way.
 */
export async function revokeClerkSessionsForEmail(email: string): Promise<void> {
  try {
    const users = await clerkClient.users.getUserList({ emailAddress: [email] });
    for (const user of users.data) {
      const sessions = await clerkClient.sessions.getSessionList({
        userId: user.id,
        status: "active",
      });
      for (const session of sessions.data) {
        await clerkClient.sessions.revokeSession(session.id);
      }
    }
  } catch (err) {
    console.error(`Failed to revoke Clerk sessions for ${email}:`, err);
  }
}
