import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const clientsTable = pgTable("clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  isDemo: boolean("is_demo").notNull().default(false),
  // Optional billing details shown in the PDF invoice "Bill to / Ship to" band.
  billingContact: text("billing_contact"),
  billingAddress: text("billing_address"),
  // Whether this client's contract includes mileage reimbursement. When off,
  // employees can't submit mileage for the client. Defaults on so existing
  // clients keep working unchanged.
  mileageOnContract: boolean("mileage_on_contract").notNull().default(true),
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
  // Optional contact details Molly keeps for the employee (separate from the
  // sign-in email above — this is how she reaches them, not how they log in).
  phone: text("phone"),
  contactEmail: text("contact_email"),
  address: text("address"),
});

// A signed-in person's request to link their email to a roster profile,
// waiting for Molly's approval. Only pending requests live here: approving
// copies the email onto the employee row and deletes the request; denying
// just deletes it. `email` is unique so one email can only have one pending
// claim at a time.
export const employeeLinkRequestsTable = pgTable("employee_link_requests", {
  id: text("id").primaryKey(),
  // Unique: one pending claim per profile, so Molly never sees competing
  // requests for the same name — the second claimant gets a clear conflict.
  employeeId: text("employee_id").notNull().unique(),
  email: text("email").notNull().unique(),
  requestedAt: timestamp("requested_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ClientRow = typeof clientsTable.$inferSelect;
export type EmployeeRow = typeof employeesTable.$inferSelect;
export type EmployeeLinkRequestRow = typeof employeeLinkRequestsTable.$inferSelect;
