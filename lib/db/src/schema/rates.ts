import { pgTable, text, serial, real } from "drizzle-orm/pg-core";

export const clientRatesTable = pgTable("client_rates", {
  id: serial("id").primaryKey(),
  clientId: text("client_id").notNull(),
  clientName: text("client_name").notNull(),
  visitType: text("visit_type").notNull(),
  rate: real("rate").notNull(),
  effectiveDate: text("effective_date").notNull(),
});

// Per-client, per-discipline employee PAY rates — the mirror of client_rates
// for hourly work whose PAY differs by client (e.g. Weiser RN $71/hr vs
// Current PT $57/hr). The `visitType` column holds the same rate keys as
// client_rates ("hourly-RN", "hourly", and optional "-weekend"/"-holiday"
// day-type variants). Append-only history like the other rate tables.
export const clientPayRatesTable = pgTable("client_pay_rates", {
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

/**
 * A per-day travel allowance an employee is paid, and the client billed, for
 * working at one clinic location — instead of mileage, not on top of it.
 *
 * Molly, 11 Sep 2026, on Current PT: "Travel for Current is per day worked...
 * specific to each employee and each clinic location, in place of mileage -
 * not in addition to (Its calculated as round trip mileage at .65/mi minus 25
 * miles when travel is >1 hour from house to clinic per our contract). This is
 * also requested by client as separate line item."
 *
 * Miles are stored rather than dollars, already net of the 25 the contract
 * deducts, because the money is only ever miles x a mileage rate — and both
 * of those rates move (hers follows GSA). Storing the dollars would freeze an
 * allowance at today's rate and quietly go wrong the next time GSA changes.
 * Append-only history like every other rate.
 */
export const employeeTravelAllowancesTable = pgTable("employee_travel_allowances", {
  id: serial("id").primaryKey(),
  employeeId: text("employee_id").notNull(),
  employeeName: text("employee_name").notNull(),
  clientId: text("client_id").notNull(),
  clientName: text("client_name").notNull(),
  /** The clinic as the employee knows it, e.g. "Fruitland". */
  location: text("location").notNull(),
  /** Billable round-trip miles for one day there, net of the contract's 25. */
  miles: real("miles").notNull(),
  effectiveDate: text("effective_date").notNull(),
});

export type EmployeeTravelAllowanceRow =
  typeof employeeTravelAllowancesTable.$inferSelect;

export type ClientRateRow = typeof clientRatesTable.$inferSelect;
export type ClientPayRateRow = typeof clientPayRatesTable.$inferSelect;
export type EmployeeRateRow = typeof employeeRatesTable.$inferSelect;
