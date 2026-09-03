import { pgTable, text, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Admin-managed catalog of employee disciplines / professions (RN, PT, OT,
// SLP, PTA, LPN, LCSW, …). Until now the discipline was free text typed into
// the "Role" box when Molly added an employee, which meant a typo ("Rn",
// "PT ") silently broke rate lookup: employees.role is the key that resolves
// visit_pay_rates.discipline and the "hourly-{ROLE}" client rate rows.
//
// The `key` is that stable lookup value and is what lands on
// employees.role (and, denormalized, on time_entries.employee_role). Molly
// picks from this list instead of typing, and employees confirm their own
// discipline when they claim a profile.
export const disciplinesTable = pgTable("disciplines", {
  // Matches employees.role and the rate keys ("RN", "PT", "PTA", …). Stored
  // exactly as it appears in rate keys — uppercase by convention, not forced,
  // because Molly may add something like "RN-BSN".
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  active: boolean("active").notNull().default(true),
  // Lower sorts first in dropdowns; ties fall back to label.
  sortOrder: integer("sort_order").notNull().default(0),
});

export const insertDisciplineSchema = createInsertSchema(disciplinesTable);
export type InsertDiscipline = z.infer<typeof insertDisciplineSchema>;
export type DisciplineRow = typeof disciplinesTable.$inferSelect;
