import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

// Lightweight per-period check-offs for the weekly guide. One row per period
// key (the Monday of the week, YYYY-MM-DD). No history beyond this.
export const workflowStatusTable = pgTable("workflow_status", {
  period: text("period").primaryKey(),
  exportDone: boolean("export_done").notNull().default(false),
  invoicesDone: boolean("invoices_done").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
