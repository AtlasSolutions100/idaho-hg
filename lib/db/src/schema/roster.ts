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
  // Whether the employee is allowed to sign in to the mobile app. Kept
  // separate from `active` (removal) so re-adding a removed employee doesn't
  // silently re-enable a deliberately disabled sign-in.
  signInEnabled: boolean("sign_in_enabled").notNull().default(true),
});

export type ClientRow = typeof clientsTable.$inferSelect;
export type EmployeeRow = typeof employeesTable.$inferSelect;
