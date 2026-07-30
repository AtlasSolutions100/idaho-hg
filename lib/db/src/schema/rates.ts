import { pgTable, text, serial, real } from "drizzle-orm/pg-core";

export const clientRatesTable = pgTable("client_rates", {
  id: serial("id").primaryKey(),
  clientId: text("client_id").notNull(),
  clientName: text("client_name").notNull(),
  visitType: text("visit_type").notNull(),
  rate: real("rate").notNull(),
  effectiveDate: text("effective_date").notNull(),
});

export const employeeRatesTable = pgTable("employee_rates", {
  id: serial("id").primaryKey(),
  employeeId: text("employee_id").notNull(),
  employeeName: text("employee_name").notNull(),
  employeeRole: text("employee_role").notNull(),
  hourlyRate: real("hourly_rate").notNull(),
  visitRate: real("visit_rate").notNull(),
  mileageRate: real("mileage_rate").notNull(),
  perDiemRate: real("per_diem_rate").notNull(),
  weekendMultiplier: real("weekend_multiplier").notNull(),
  holidayMultiplier: real("holiday_multiplier").notNull(),
  effectiveDate: text("effective_date").notNull(),
});

export type ClientRateRow = typeof clientRatesTable.$inferSelect;
export type EmployeeRateRow = typeof employeeRatesTable.$inferSelect;
