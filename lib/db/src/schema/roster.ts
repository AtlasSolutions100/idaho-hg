import { pgTable, text, boolean } from "drizzle-orm/pg-core";

export const clientsTable = pgTable("clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
});

export const employeesTable = pgTable("employees", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  active: boolean("active").notNull().default(true),
});

export type ClientRow = typeof clientsTable.$inferSelect;
export type EmployeeRow = typeof employeesTable.$inferSelect;
