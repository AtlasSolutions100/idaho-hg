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
  // Last day covered by this entry, for entries that span a range rather than
  // a single day. Only mileage entries use it today: St. Luke's employees pull
  // a mileage report off the client's device for a whole pay period and enter
  // one total, so the entry covers date..endDate. NULL = a single-day entry.
  endDate: text("end_date"),
  visitType: text("visit_type"),
  // What kind of hours an hourly entry covers: null/"regular" is ordinary
  // worked time, "on-call" is time carried on call, "call-back" is being
  // called in while on call. Idaho Youth Ranch pays these at their own
  // rates, and call-back carries a contract minimum (clients.call_back_
  // minimum_hours). Visit-billing clients never use it.
  hourKind: text("hour_kind"),
  // The clinic location worked at, for clients that pay a per-day travel
  // allowance instead of mileage (Current PT). Null everywhere else.
  travelLocation: text("travel_location"),
  // How many of this visit type the entry covers. Two things need it:
  //   - the same visit more than once in a day (two evals and a discharge is
  //     one eval line with quantity 2, plus a discharge line);
  //   - "increment" visit types (see visit_types.billing_unit), where the
  //     quantity is the number of 15-minute blocks — a half hour is 2.
  // Always >= 1 and 1 for every entry that predates this column, so pay and
  // billing for existing entries are unchanged (rate x 1).
  quantity: real("quantity").notNull().default(1),
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
