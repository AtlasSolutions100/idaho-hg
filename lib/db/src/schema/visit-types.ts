import {
  pgTable,
  text,
  serial,
  real,
  integer,
  boolean,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Admin-managed catalog of visit types (St. Luke's SOC, SNV, Eval, …). Replaces
// the previously hardcoded visit-type enum so Molly can add/rename/retire a type
// herself with no code change. The `key` is the stable slug stored on time
// entries and rate rows (time_entries.visit_type, client_rates.visit_type,
// visit_pay_rates.visit_type all reference it by string).
export const visitTypesTable = pgTable("visit_types", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  abbreviation: text("abbreviation").notNull(),
  active: boolean("active").notNull().default(true),
  // Lower sorts first in dropdowns; ties fall back to label.
  sortOrder: integer("sort_order").notNull().default(0),
});

export const insertVisitTypeSchema = createInsertSchema(visitTypesTable);
export type VisitTypeRow = typeof visitTypesTable.$inferSelect;

// Per-discipline, per-visit-type employee PAY rates — the matrix Molly keeps
// in her spreadsheet (e.g. RN start-of-care = $268, RN SNV = $100.80). Stored
// append-only with an effective date, exactly like client_rates: the "current"
// pay rate for a (discipline, visitType) is the row with the latest effective
// date (ties broken by newest id). This replaces the single flat
// employee_rates.visitRate for visit-based pay.
export const visitPayRatesTable = pgTable("visit_pay_rates", {
  id: serial("id").primaryKey(),
  // Employee discipline (RN, PT, OT, SLP, PTA, LCSW, …) — matches employees.role.
  discipline: text("discipline").notNull(),
  // Visit-type key — references visit_types.key.
  visitType: text("visit_type").notNull(),
  rate: real("rate").notNull(),
  effectiveDate: text("effective_date").notNull(),
});

export const insertVisitPayRateSchema = createInsertSchema(visitPayRatesTable).omit({
  id: true,
});
export type InsertVisitPayRate = z.infer<typeof insertVisitPayRateSchema>;
export type VisitPayRateRow = typeof visitPayRatesTable.$inferSelect;
