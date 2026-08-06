import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  clientsTable,
  employeesTable,
  employeeLinkRequestsTable,
  clientRatesTable,
  employeeRatesTable,
  type ClientRow,
  type EmployeeRow,
} from "@workspace/db";
import {
  CreateClientBody,
  CreateEmployeeBody,
  UpdateClientBillingBody,
  UpdateEmployeeContactBody,
  UpdateEmployeeEmailBody,
  UpdateEmployeeSignInAccessBody,
} from "@workspace/api-zod";
import {
  ensureClerkUserForEmail,
  requireAdmin,
  requireSignedIn,
  verifyAdminRequest,
  requireEmployee,
  revokeClerkSessionsForEmail,
} from "../lib/employee-auth";
import {
  hasDemoEmployeeData,
  purgeDemoEmployeeData,
} from "../lib/demo-cleanup";

const router: IRouter = Router();

// Seed the roster tables once so a fresh database starts with Molly's real
// clients and employees (UUIDs match the live database).
const seedClients = [
  {
    id: "1",
    name: "St. Luke's Health System",
    billingAddress: "St Lukes Health System, Ltd\n190 E Bannock St\nBoise, ID 83712",
  },
  { id: "2", name: "Weiser Memorial Hospital" },
  {
    id: "3",
    name: "Idaho Youth Ranch",
    billingContact: "Rosie Rios",
    billingAddress: "Idaho Youth Ranch\n5465 W Irving Street\nBoise, ID 83706",
  },
  { id: "4", name: "Treasure Valley Outpatient Clinic" },
  // Meridian Senior Care (id 5) was seeded as a placeholder — confirmed not a
  // real client, so it is seeded inactive to keep legacy IDs stable.
  { id: "5", name: "Meridian Senior Care", active: false },
  {
    id: "6",
    name: "Current PT",
    billingContact: "Nick Hartley",
    billingAddress: "Current PT, Fruitland\n2175 N. Whitley Dr\nFruitland, ID 83619",
  },
  {
    id: "7",
    name: "Thrive",
    billingContact: "Jody A Thatcher",
    billingAddress: "Physical Therapy at Thrive\n2302 N Bogus Basin road\nSuite C\nBoise, ID 83702",
  },
];

// Billing details confirmed from real QuickBooks invoices. Only applied to
// rows where billing_address is still NULL so any manually-entered address
// Molly already set is never overwritten.
const knownBillingDetails: Array<{
  id: string;
  billingContact?: string;
  billingAddress: string;
}> = [
  {
    id: "1",
    billingAddress: "St Lukes Health System, Ltd\n190 E Bannock St\nBoise, ID 83712",
  },
  {
    id: "3",
    billingContact: "Rosie Rios",
    billingAddress: "Idaho Youth Ranch\n5465 W Irving Street\nBoise, ID 83706",
  },
  {
    id: "6",
    billingContact: "Nick Hartley",
    billingAddress: "Current PT, Fruitland\n2175 N. Whitley Dr\nFruitland, ID 83619",
  },
  {
    id: "7",
    billingContact: "Jody A Thatcher",
    billingAddress: "Physical Therapy at Thrive\n2302 N Bogus Basin road\nSuite C\nBoise, ID 83702",
  },
];

// Clients added after the original seed. Existing (non-empty) databases skip
// the full seed, so these are backfilled idempotently on every startup.
const backfillClients = [
  { id: "6", name: "Current PT" },
  { id: "7", name: "Thrive" },
];

const seedEmployees = [
  { id: "ed7ff5a6-408c-46ae-a6d1-f8fb6ec85b1b", name: "Molly Hodge", role: "PT" },
  { id: "70a76167-a476-4268-a2fc-d89c7ed15e6e", name: "Dale Gibbs", role: "PT" },
  { id: "149d3f0a-08dc-48e4-a2d5-5f74df82e9ba", name: "Emily Greer", role: "PT" },
  { id: "c173f799-2391-4acb-b7d8-bd6c1f7811ca", name: "Quinton Erhard", role: "PT" },
  { id: "e2ae91e4-d3d8-4447-b4ce-85de035b6700", name: "Adrian Eddins", role: "RN" },
  { id: "671910f2-7fa0-4eae-8b61-717191a00bab", name: "Ronda Stewart", role: "RN" },
  { id: "e0abb6d8-30a9-4cbd-a777-ac134f373872", name: "Amber Edwards", role: "RN" },
  { id: "cdd04b02-8b43-4b1d-9da6-b394a67cfdfc", name: "Sandy Clayton", role: "RN" },
  { id: "0b970f7e-1788-4b52-be50-811ad8ce9b9a", name: "Bree Whiting", role: "RN" },
  { id: "42f630fa-1049-4a46-8a65-70ffcfbe98d5", name: "Brandon Whiting", role: "OT" },
  { id: "782448f4-2acd-4ee1-a40f-80d930ebcd7f", name: "Joshua Johansen", role: "OT" },
  { id: "5cc9fff2-5c2e-41cd-bd56-50cce1a5532d", name: "Lee Hamilton", role: "OT" },
  { id: "1d2c2efe-bed4-4b2e-aba4-194130b0a0b7", name: "Lee Ormsby", role: "PTA" },
  { id: "1da47ea1-da22-41f3-aef2-542c42d47a21", name: "Ameliana Samarin", role: "SLP" },
  { id: "5f4d261e-28c3-4bea-a6e4-99e171ac07c0", name: "Mel Plourde", role: "LCSW" },
  { id: "d324d661-8c8c-4414-be27-855f48d4ed26", name: "Paige Barbero", role: "PT" },
];

let seeded = false;
export async function ensureRosterSeeded() {
  if (seeded) return;
  // Guard: if legacy demo employees (IDs "1"–"6") resurfaced (e.g. via a
  // restored backup), purge them and skip the full seed — the database is
  // not fresh, so seeding would only mix demo remnants with real data. The
  // idempotent backfills below still run so such a database isn't left
  // missing later-added clients.
  if (await hasDemoEmployeeData()) {
    await purgeDemoEmployeeData();
  } else {
    const [clientRow] = await db.select().from(clientsTable).limit(1);
    if (!clientRow) {
      await db.insert(clientsTable).values(seedClients);
    }
    const [employeeRow] = await db.select().from(employeesTable).limit(1);
    if (!employeeRow) {
      await db.insert(employeesTable).values(seedEmployees);
    }
  }
  // Backfill later-added clients into already-populated databases (no-op when
  // the row already exists, so this is safe to run on every startup).
  await db.insert(clientsTable).values(backfillClients).onConflictDoNothing();
  // Meridian Senior Care (id 5) is not a real client — ensure it stays inactive
  // in any database that was seeded before this was established.
  await db
    .update(clientsTable)
    .set({ active: false })
    .where(eq(clientsTable.id, "5"));
  // Backfill confirmed billing details into existing databases. Only updates
  // rows where billing_address is still NULL so any address Molly already
  // entered manually is never overwritten.
  for (const detail of knownBillingDetails) {
    await db
      .update(clientsTable)
      .set({
        billingAddress: detail.billingAddress,
        ...(detail.billingContact ? { billingContact: detail.billingContact } : {}),
      })
      .where(and(eq(clientsTable.id, detail.id), isNull(clientsTable.billingAddress)));
  }
  seeded = true;
}

function serializeClient(row: ClientRow) {
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    isDemo: row.isDemo,
    // Optional billing details — omitted (undefined) when not set so clients
    // without an address are unchanged.
    ...(row.billingContact ? { billingContact: row.billingContact } : {}),
    ...(row.billingAddress ? { billingAddress: row.billingAddress } : {}),
  };
}

function serializeEmployee(row: EmployeeRow, opts?: { includeContact?: boolean }) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    active: row.active,
    isDemo: row.isDemo,
    ...(row.email ? { email: row.email } : {}),
    signInEnabled: row.signInEnabled,
    // Contact details are personal info — only included for Molly's verified
    // admin session (default off so no caller gets them by accident).
    ...(opts?.includeContact
      ? {
          ...(row.phone ? { phone: row.phone } : {}),
          ...(row.contactEmail ? { contactEmail: row.contactEmail } : {}),
          ...(row.address ? { address: row.address } : {}),
        }
      : {}),
  };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate + normalize a sign-in email and make sure no other employee uses
 * it. Returns the normalized email, null (cleared), or an error message.
 */
async function prepareEmployeeEmail(
  rawEmail: string,
  excludeEmployeeId?: string,
): Promise<{ email: string | null } | { error: string; status: number }> {
  const email = rawEmail.trim().toLowerCase();
  if (!email) return { email: null };
  if (!EMAIL_PATTERN.test(email)) {
    return { error: "That doesn't look like a valid email address.", status: 400 };
  }
  const existing = await db.select().from(employeesTable);
  const match = existing.find(
    (e) => e.email === email && e.id !== excludeEmployeeId,
  );
  if (match) {
    return {
      error: `That email is already used by ${match.name}.`,
      status: 409,
    };
  }
  return { email };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Postgres unique-constraint violation on the employee email index. */
function isUniqueEmailViolation(err: unknown): boolean {
  const cause =
    err && typeof err === "object" && "cause" in err ? (err as { cause?: unknown }).cause : undefined;
  for (const candidate of [err, cause]) {
    if (
      candidate &&
      typeof candidate === "object" &&
      "code" in candidate &&
      (candidate as { code?: unknown }).code === "23505" &&
      String((candidate as { constraint?: unknown }).constraint ?? "").includes("email")
    ) {
      return true;
    }
  }
  return false;
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
    const existing = await db.select().from(clientsTable);
    const match = existing.find(
      (c) => c.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (match) {
      res.status(409).json({
        message: match.active
          ? `A client named "${match.name}" already exists.`
          : `A removed client named "${match.name}" already exists. Restore it instead of adding a duplicate.`,
      });
      return;
    }
    const id = randomUUID();
    const billingContact = body.billingContact?.trim() || null;
    const billingAddress = body.billingAddress?.trim() || null;
    const [row] = await db
      .insert(clientsTable)
      .values({ id, name, billingContact, billingAddress })
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

router.patch("/clients/:id", async (req, res, next) => {
  try {
    await ensureRosterSeeded();
    const parsed = UpdateClientBillingBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ message: parsed.error.issues[0]?.message ?? "Invalid billing details" });
      return;
    }
    // Blank strings clear the field — Molly can remove an address she added.
    const [row] = await db
      .update(clientsTable)
      .set({
        billingContact: parsed.data.billingContact?.trim() || null,
        billingAddress: parsed.data.billingAddress?.trim() || null,
      })
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

// The list needs at least a signed-in session — names/roles/sign-in status
// are not public. Any session (even one not yet linked to a roster profile)
// may read it, because the mobile claim-your-name flow lists employees
// before the caller is linked.
router.get("/employees", requireSignedIn, async (req, res, next) => {
  try {
    await ensureRosterSeeded();
    const rows = await db
      .select()
      .from(employeesTable)
      .where(eq(employeesTable.active, true));
    rows.sort((a, b) => a.name.localeCompare(b.name));
    // Contact details (phone, personal email, home address) are only shown
    // to Molly's verified admin session — the list itself stays available to
    // the app's other consumers without exposing personal info.
    const includeContact = (await verifyAdminRequest(req).catch(() => ({ ok: false }))).ok;
    res.json(rows.map((row) => serializeEmployee(row, { includeContact })));
  } catch (err) {
    next(err);
  }
});

// Admin-only: creating roster rows (with or without contact/sign-in info)
// is Molly's job — anonymous or non-admin creation is rejected outright.
router.post("/employees", requireAdmin, async (req, res, next) => {
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
    const existing = await db.select().from(employeesTable);
    const match = existing.find(
      (e) => e.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (match) {
      res.status(409).json({
        message: match.active
          ? `An employee named "${match.name}" already exists.`
          : `A removed employee named "${match.name}" already exists. Restore them instead of adding a duplicate.`,
      });
      return;
    }
    const phone = body.phone?.trim() || null;
    const contactEmail = body.contactEmail?.trim().toLowerCase() || null;
    const address = body.address?.trim() || null;
    if (contactEmail && !EMAIL_PATTERN.test(contactEmail)) {
      res.status(400).json({ message: "That doesn't look like a valid contact email address." });
      return;
    }
    let email: string | null = null;
    if (body.email !== undefined) {
      const prepared = await prepareEmployeeEmail(body.email);
      if ("error" in prepared) {
        res.status(prepared.status).json({ message: prepared.error });
        return;
      }
      email = prepared.email;
    }
    // Provision the Clerk user first (idempotent) so a Clerk failure can't
    // leave a half-created employee behind.
    if (email) {
      await ensureClerkUserForEmail(email);
    }
    const id = randomUUID();
    const row = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(employeesTable)
        .values({ id, name, role, email, phone, contactEmail, address })
        .returning();
      await tx.insert(employeeRatesTable).values({
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
      return inserted;
    });
    res.status(201).json(serializeEmployee(row, { includeContact: true }));
  } catch (err) {
    if (isUniqueEmailViolation(err)) {
      res.status(409).json({ message: "That email is already used by another employee." });
      return;
    }
    next(err);
  }
});

router.get("/me", requireEmployee, async (req, res, next) => {
  try {
    await ensureRosterSeeded();
    const { employee } = req as typeof req & {
      employee: import("@workspace/db").EmployeeRow;
    };
    res.json(serializeEmployee(employee, { includeContact: true }));
  } catch (err) {
    next(err);
  }
});

/**
 * Shared body of the two contact-update routes: validate the fields, apply
 * only the ones present in the request (blank strings clear a field), and
 * respond with the updated employee. The caller decides WHOSE row may be
 * edited — Molly picks any id, an employee is pinned to their own row.
 */
async function applyContactUpdate(
  employeeId: string,
  body: unknown,
  res: import("express").Response,
) {
  const parsed = UpdateEmployeeContactBody.safeParse(body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ message: parsed.error.issues[0]?.message ?? "Invalid contact details" });
    return;
  }
  const contactEmail = parsed.data.contactEmail?.trim().toLowerCase() || null;
  if (contactEmail && !EMAIL_PATTERN.test(contactEmail)) {
    res.status(400).json({ message: "That doesn't look like a valid email address." });
    return;
  }
  const updates: Partial<{
    phone: string | null;
    contactEmail: string | null;
    address: string | null;
  }> = {};
  if (parsed.data.phone !== undefined) updates.phone = parsed.data.phone.trim() || null;
  if (parsed.data.contactEmail !== undefined) updates.contactEmail = contactEmail;
  if (parsed.data.address !== undefined) updates.address = parsed.data.address.trim() || null;
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ message: "Nothing to update." });
    return;
  }
  const [row] = await db
    .update(employeesTable)
    .set(updates)
    .where(eq(employeesTable.id, employeeId))
    .returning();
  if (!row) {
    res.status(404).json({ message: "Employee not found" });
    return;
  }
  res.json(serializeEmployee(row, { includeContact: true }));
}

// Self-service: a signed-in employee edits their OWN contact details. The
// target row comes from the session-resolved employee, never from the
// request, so nobody can edit anyone else's record.
router.patch("/me/contact", requireEmployee, async (req, res, next) => {
  try {
    await ensureRosterSeeded();
    const { employee } = req as typeof req & {
      employee: import("@workspace/db").EmployeeRow;
    };
    await applyContactUpdate(employee.id, req.body, res);
  } catch (err) {
    next(err);
  }
});

// Admin-only: contact details live on the same roster row Molly manages, so
// writes go through her verified session like the other employee edits.
router.patch("/employees/:id/contact", requireAdmin, async (req, res, next) => {
  try {
    await ensureRosterSeeded();
    await applyContactUpdate(String(req.params.id), req.body, res);
  } catch (err) {
    next(err);
  }
});

// Admin-only: changing a profile's sign-in email grants (or moves) app
// access, so it must come from Molly's verified session — otherwise anyone
// could bypass the link-request approval flow.
router.patch("/employees/:id", requireAdmin, async (req, res, next) => {
  try {
    await ensureRosterSeeded();
    const parsed = UpdateEmployeeEmailBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ message: parsed.error.issues[0]?.message ?? "Invalid email" });
      return;
    }
    const prepared = await prepareEmployeeEmail(parsed.data.email, String(req.params.id));
    if ("error" in prepared) {
      res.status(prepared.status).json({ message: prepared.error });
      return;
    }
    // Provision the Clerk user first (idempotent) so we never persist an
    // email the employee can't actually sign in with.
    if (prepared.email) {
      await ensureClerkUserForEmail(prepared.email);
    }
    // Transaction with a row lock so manual edits serialize with link-request
    // approval (which locks the same employee row). Setting an email manually
    // also clears any pending link requests for this profile — they are stale
    // the moment Molly types an email in herself.
    const row = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(employeesTable)
        .where(eq(employeesTable.id, String(req.params.id)))
        .for("update");
      if (!locked) return null;
      const [updated] = await tx
        .update(employeesTable)
        .set({ email: prepared.email })
        .where(eq(employeesTable.id, locked.id))
        .returning();
      await tx
        .delete(employeeLinkRequestsTable)
        .where(eq(employeeLinkRequestsTable.employeeId, locked.id));
      if (prepared.email) {
        // The email can no longer claim anything else either.
        await tx
          .delete(employeeLinkRequestsTable)
          .where(eq(employeeLinkRequestsTable.email, prepared.email));
      }
      return updated ?? null;
    });
    if (!row) {
      res.status(404).json({ message: "Employee not found" });
      return;
    }
    res.json(serializeEmployee(row, { includeContact: true }));
  } catch (err) {
    if (isUniqueEmailViolation(err)) {
      res.status(409).json({ message: "That email is already used by another employee." });
      return;
    }
    next(err);
  }
});

router.patch("/employees/:id/sign-in-access", requireAdmin, async (req, res, next) => {
  try {
    await ensureRosterSeeded();
    const parsed = UpdateEmployeeSignInAccessBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ message: parsed.error.issues[0]?.message ?? "Invalid request" });
      return;
    }
    const [row] = await db
      .update(employeesTable)
      .set({ signInEnabled: parsed.data.signInEnabled })
      // String(): with a middleware in the chain, Express widens the param
      // type to string | string[]; this route's :id is always a single string.
      .where(eq(employeesTable.id, String(req.params.id)))
      .returning();
    if (!row) {
      res.status(404).json({ message: "Employee not found" });
      return;
    }
    // Disabling sign-in also ends the employee's live app session(s) so they
    // drop to the sign-in screen right away instead of only seeing blocked
    // requests. Best-effort: a Clerk hiccup never fails the toggle — the
    // per-request SIGN_IN_DISABLED block still guarantees no access.
    if (!parsed.data.signInEnabled && row.email) {
      await revokeClerkSessionsForEmail(row.email);
    }
    res.json(serializeEmployee(row, { includeContact: true }));
  } catch (err) {
    next(err);
  }
});

// Admin-only: removing an employee cuts off their app access and hides them
// from reports — only Molly's verified session may do it.
router.delete("/employees/:id", requireAdmin, async (req, res, next) => {
  try {
    await ensureRosterSeeded();
    const [row] = await db
      .update(employeesTable)
      .set({ active: false })
      // String(): with a middleware in the chain, Express widens the param
      // type to string | string[]; this route's :id is always a single string.
      .where(eq(employeesTable.id, String(req.params.id)))
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
