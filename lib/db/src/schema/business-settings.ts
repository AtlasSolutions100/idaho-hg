import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

// Single-row settings for the business details printed on PDF invoices,
// plus the auto-incrementing invoice number counter. Always keyed by
// 'singleton' — there is exactly one business (Hodge Staffing).
export const businessSettingsTable = pgTable("business_settings", {
  id: text("id").primaryKey(),
  address: text("address").notNull().default(""),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),
  paymentTerms: text("payment_terms").notNull().default(""),
  // The number the NEXT generated invoice will get.
  nextInvoiceNumber: integer("next_invoice_number").notNull().default(1),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
