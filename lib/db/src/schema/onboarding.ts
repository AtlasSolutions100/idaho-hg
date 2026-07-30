import {
  pgTable,
  text,
  serial,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Per-employee onboarding checklist state. This is a tracking/to-do tool
// only: no documents or sensitive data are ever stored — just whether an
// item is done. The item definitions (keys/labels) live in shared code so
// the list stays consistent for every employee.
export const onboardingItemsTable = pgTable(
  "onboarding_items",
  {
    id: serial("id").primaryKey(),
    employeeId: text("employee_id").notNull(),
    itemKey: text("item_key").notNull(),
    completed: boolean("completed").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("onboarding_items_employee_item_idx").on(
      table.employeeId,
      table.itemKey,
    ),
  ],
);

export type OnboardingItemRow = typeof onboardingItemsTable.$inferSelect;
