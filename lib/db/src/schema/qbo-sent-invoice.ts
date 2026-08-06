import { pgTable, text, boolean, timestamp, index } from "drizzle-orm/pg-core";

// Every successful "Send to QuickBooks" is recorded here so the app can warn
// before the same client + billing period is sent again. Append-only: a
// confirmed re-send adds another row (the newest row is what the warning
// shows). Rows survive refreshes/restarts because they live in the database.
export const qboSentInvoicesTable = pgTable(
  "qbo_sent_invoices",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull(),
    periodStart: text("period_start").notNull(), // YYYY-MM-DD
    periodEnd: text("period_end").notNull(), // YYYY-MM-DD
    qboInvoiceId: text("qbo_invoice_id").notNull(),
    docNumber: text("doc_number"), // QuickBooks invoice number, when assigned
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    // Practice rows seeded by the demo-data loader (never actually sent to
    // QuickBooks); removed with the rest of the demo data.
    isDemo: boolean("is_demo").notNull().default(false),
  },
  (table) => [
    index("qbo_sent_invoices_client_period_idx").on(
      table.clientId,
      table.periodStart,
      table.periodEnd,
    ),
  ],
);

export type QboSentInvoiceRow = typeof qboSentInvoicesTable.$inferSelect;
