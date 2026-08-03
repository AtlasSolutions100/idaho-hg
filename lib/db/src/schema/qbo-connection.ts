import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Single QuickBooks Online connection for the business (singleton row).
// Tokens are server-side only and must never be sent to the browser.
export const qboConnectionTable = pgTable("qbo_connection", {
  id: text("id").primaryKey(), // always "singleton"
  realmId: text("realm_id").notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }).notNull(),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }).notNull(),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
