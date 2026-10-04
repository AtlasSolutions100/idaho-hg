import { pgTable, text, boolean, timestamp, real } from "drizzle-orm/pg-core";

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
  // Whether this client bills by visit type (St. Luke's). When off, employees
  // only log time in/out — the visit-type flow is hidden and rejected.
  billsByVisitType: boolean("bills_by_visit_type").notNull().default(false),
  // Per-client weekend/holiday pay+bill multipliers (e.g. St. Luke's applies
  // +10% => 1.1 to both billing and pay). Default 1 = no change. Applied when a
  // rate row has no explicit "-weekend"/"-holiday" variant for that day type.
  weekendMultiplier: real("weekend_multiplier").notNull().default(1),
  holidayMultiplier: real("holiday_multiplier").notNull().default(1),
  // Optional free-text footer note shown on this client's PDF invoice
  // (e.g. Weiser's "Time cards will be sent for reconciliation…").
  noteToCustomer: text("note_to_customer"),
  // Hours a call-back is paid and billed for even when the visit is
  // shorter — Idaho Youth Ranch's contract says 4. 0 = no minimum.
  callBackMinimumHours: real("call_back_minimum_hours").notNull().default(0),
});

// One-time data backfills that have been applied to this database. Lets
// startup backfills run exactly once so later admin changes aren't stomped.
export const appliedBackfillsTable = pgTable("applied_backfills", {
  name: text("name").primaryKey(),
  appliedAt: timestamp("applied_at").notNull().defaultNow(),
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
  // The discipline the claimant picked for themselves. Kept on the request
  // (rather than written straight to the profile) so Molly sees what they
  // claim — and any disagreement with the roster — before she approves.
  claimedDiscipline: text("claimed_discipline"),
  requestedAt: timestamp("requested_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ClientRow = typeof clientsTable.$inferSelect;
export type EmployeeRow = typeof employeesTable.$inferSelect;
export type EmployeeLinkRequestRow = typeof employeeLinkRequestsTable.$inferSelect;
