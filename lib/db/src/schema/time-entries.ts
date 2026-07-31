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
  hours: real("hours"),
  mileage: real("mileage"),
  perDiem: real("per_diem"),
  isWeekend: boolean("is_weekend").notNull().default(false),
  isHoliday: boolean("is_holiday").notNull().default(false),
  note: text("note"),
  status: text("status").notNull().default("submitted"),
  isDemo: boolean("is_demo").notNull().default(false),
  submittedAt: timestamp("submitted_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
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
