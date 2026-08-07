import {
  pgTable,
  text,
  serial,
  real,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const timeEntriesTable = pgTable("time_entries", {
  id: serial("id").primaryKey(),
  employeeId: text("employee_id").notNull(),
  employeeName: text("employee_name").notNull(),
  employeeRole: text("employee_role").notNull(),
  clientId: text("client_id").notNull(),
  clientName: text("client_name").notNull(),
  date: text("date").notNull(),
  visitType: text("visit_type"),
  // Clock times ("HH:MM", 24-hour). When present, `hours` is computed from
  // them on the server; older entries only have `hours`.
  timeIn: text("time_in"),
  timeOut: text("time_out"),
  hours: real("hours"),
  mileage: real("mileage"),
  perDiem: real("per_diem"),
  // "first_last" | "full" — the option the employee picked. Older entries
  // only carry the numeric perDiem (which allowed 0.5 half-days).
  perDiemType: text("per_diem_type"),
  isWeekend: boolean("is_weekend").notNull().default(false),
  isHoliday: boolean("is_holiday").notNull().default(false),
  note: text("note"),
  // "Other" one-offs (training, meetings, professional development): the
  // employee describes the work in `note` and logs time; the entry has no
  // visit type and no standard rate. Molly sets the pay (and optionally a
  // client billing amount) while reviewing. Entries never change kind after
  // creation.
  isOther: boolean("is_other").notNull().default(false),
  // Admin-set flat dollar amounts for "Other" entries. Pay is what the
  // employee receives; bill (optional) is what the client is invoiced.
  customPayAmount: real("custom_pay_amount"),
  customBillAmount: real("custom_bill_amount"),
  status: text("status").notNull().default("submitted"),
  isDemo: boolean("is_demo").notNull().default(false),
  submittedAt: timestamp("submitted_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  // Set when Molly (admin) edits the entry during approval — the audit trail
  // the employee sees. Summary is a human-readable list of what changed.
  adminEditedAt: timestamp("admin_edited_at", { withTimezone: true }),
  adminEditSummary: text("admin_edit_summary"),
});

export const insertTimeEntrySchema = createInsertSchema(timeEntriesTable).omit(
  {
    id: true,
    submittedAt: true,
    approvedAt: true,
  },
);
export type InsertTimeEntry = z.infer<typeof insertTimeEntrySchema>;
export type TimeEntryRow = typeof timeEntriesTable.$inferSelect;
