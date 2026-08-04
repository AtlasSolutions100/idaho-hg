import { pgTable, text, boolean } from "drizzle-orm/pg-core";

export const clientsTable = pgTable("clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  isDemo: boolean("is_demo").notNull().default(false),
  // Optional billing details shown in the PDF invoice "Bill to / Ship to" band.
  billingContact: text("billing_contact"),
  billingAddress: text("billing_address"),
});

export const employeesTable = pgTable("employees", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  active: boolean("active").notNull().default(true),
  isDemo: boolean("is_demo").notNull().default(false),
  // Sign-in email for the employee mobile app. Stored lowercase; unique so a
  // signed-in email maps to exactly one employee.
  email: text("email").unique(),
});

export type ClientRow = typeof clientsTable.$inferSelect;
export type EmployeeRow = typeof employeesTable.$inferSelect;
