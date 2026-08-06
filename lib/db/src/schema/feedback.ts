import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";

// In-app feedback from Molly and her team to the developers.
// Kept intentionally simple: no status workflow or attachments yet.
export const feedbackTable = pgTable("feedback", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(), // "problem" | "idea" | "other"
  message: text("message").notNull(),
  name: text("name"), // optional — who sent it
  page: text("page"), // app path where the dialog was opened
  // Practice rows seeded by the demo-data loader; removed with it.
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
