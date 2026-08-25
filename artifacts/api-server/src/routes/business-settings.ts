import { Router, json, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, businessSettingsTable } from "@workspace/db";
import { requireAdmin } from "../lib/employee-auth";

const router: IRouter = Router();

// Business settings (invoice header details + the next-invoice-number counter)
// are only ever read or written from Molly's admin screens — all admin-gated.

// Single business (Hodge Staffing), single settings row.
const SINGLETON_ID = "singleton";
const MAX_TEXT = 500;

const DEFAULTS = {
  address: "",
  phone: "",
  email: "",
  paymentTerms: "",
  nextInvoiceNumber: 1,
};

function serialize(row: typeof businessSettingsTable.$inferSelect) {
  return {
    address: row.address,
    phone: row.phone,
    email: row.email,
    paymentTerms: row.paymentTerms,
    nextInvoiceNumber: row.nextInvoiceNumber,
  };
}

router.get("/business-settings", requireAdmin, async (_req, res) => {
  const [row] = await db
    .select()
    .from(businessSettingsTable)
    .where(eq(businessSettingsTable.id, SINGLETON_ID));
  return res.json(row ? serialize(row) : DEFAULTS);
});

router.put("/business-settings", requireAdmin, json({ limit: "16kb" }), async (req, res) => {
  const { address, phone, email, paymentTerms, nextInvoiceNumber } = req.body ?? {};

  for (const [name, value] of [
    ["address", address],
    ["phone", phone],
    ["email", email],
    ["paymentTerms", paymentTerms],
  ] as const) {
    if (value !== undefined && (typeof value !== "string" || value.length > MAX_TEXT)) {
      return res.status(400).json({ message: `${name} must be text up to ${MAX_TEXT} characters` });
    }
  }
  if (
    nextInvoiceNumber !== undefined &&
    (typeof nextInvoiceNumber !== "number" || !Number.isInteger(nextInvoiceNumber) || nextInvoiceNumber < 1)
  ) {
    return res.status(400).json({ message: "nextInvoiceNumber must be a whole number of at least 1" });
  }

  // Partial update: only fields present in the body change.
  const [row] = await db
    .insert(businessSettingsTable)
    .values({
      id: SINGLETON_ID,
      address: typeof address === "string" ? address.trim() : "",
      phone: typeof phone === "string" ? phone.trim() : "",
      email: typeof email === "string" ? email.trim() : "",
      paymentTerms: typeof paymentTerms === "string" ? paymentTerms.trim() : "",
      nextInvoiceNumber: nextInvoiceNumber ?? 1,
    })
    .onConflictDoUpdate({
      target: businessSettingsTable.id,
      set: {
        ...(address !== undefined ? { address: address.trim() } : {}),
        ...(phone !== undefined ? { phone: phone.trim() } : {}),
        ...(email !== undefined ? { email: email.trim() } : {}),
        ...(paymentTerms !== undefined ? { paymentTerms: paymentTerms.trim() } : {}),
        ...(nextInvoiceNumber !== undefined ? { nextInvoiceNumber } : {}),
        updatedAt: sql`now()`,
      },
    })
    .returning();
  return res.json(serialize(row!));
});

// Atomically hand out the next invoice number and advance the counter, even
// under concurrent requests. Fresh insert: counter row starts with next=2 and
// number 1 is allocated; conflict: stored n is allocated and the row moves to n+1.
router.post("/business-settings/next-invoice-number", requireAdmin, async (_req, res) => {
  const [row] = await db
    .insert(businessSettingsTable)
    .values({ id: SINGLETON_ID, nextInvoiceNumber: 2 })
    .onConflictDoUpdate({
      target: businessSettingsTable.id,
      set: {
        nextInvoiceNumber: sql`${businessSettingsTable.nextInvoiceNumber} + 1`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ next: businessSettingsTable.nextInvoiceNumber });
  return res.json({ invoiceNumber: row!.next - 1 });
});

export default router;
