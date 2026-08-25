import { Router, json, type IRouter } from "express";
import { desc } from "drizzle-orm";
import { db, feedbackTable } from "@workspace/db";
import { requireAdmin, requireSignedIn } from "../lib/employee-auth";

const router: IRouter = Router();

// Reading the submitted feedback is Molly's admin view (requireAdmin below).
// Submitting is open to any signed-in user (requireSignedIn below) so
// employees and Molly can send feedback — the list stays bounded, POST bodies
// are small, and submissions are throttled per client to limit abuse.

/** Most recent submissions returned by GET /feedback. */
const LIST_LIMIT = 200;

// Simple in-memory throttle: max POSTs per client IP per window. Resets on
// server restart, which is fine for a light abuse brake (not a security boundary).
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
const recentByIp = new Map<string, number[]>();

function throttled(ip: string): boolean {
  const now = Date.now();
  const stamps = (recentByIp.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (stamps.length >= MAX_PER_WINDOW) {
    recentByIp.set(ip, stamps);
    return true;
  }
  stamps.push(now);
  recentByIp.set(ip, stamps);
  // Keep the map from growing without bound.
  if (recentByIp.size > 1000) {
    for (const [key, times] of recentByIp) {
      if (times.every((t) => now - t >= WINDOW_MS)) recentByIp.delete(key);
    }
  }
  return false;
}

const FEEDBACK_TYPES = ["problem", "idea", "other"] as const;
type FeedbackType = (typeof FEEDBACK_TYPES)[number];

const MAX_MESSAGE = 5000;
const MAX_SHORT = 200;

function serialize(row: typeof feedbackTable.$inferSelect) {
  return {
    id: row.id,
    type: row.type,
    message: row.message,
    ...(row.name != null ? { name: row.name } : {}),
    ...(row.page != null ? { page: row.page } : {}),
    createdAt: row.createdAt.toISOString(),
  };
}

router.get("/feedback", requireAdmin, async (_req, res) => {
  const rows = await db
    .select()
    .from(feedbackTable)
    .orderBy(desc(feedbackTable.createdAt), desc(feedbackTable.id))
    .limit(LIST_LIMIT);
  return res.json(rows.map(serialize));
});

router.post("/feedback", requireSignedIn, json({ limit: "16kb" }), async (req, res) => {
  if (throttled(req.ip ?? "unknown")) {
    return res
      .status(429)
      .json({ message: "You're sending feedback very quickly — please wait a minute and try again." });
  }
  const { type, message, name, page } = req.body ?? {};
  if (!FEEDBACK_TYPES.includes(type as FeedbackType)) {
    return res.status(400).json({ message: "type must be problem, idea, or other" });
  }
  if (typeof message !== "string" || message.trim() === "") {
    return res.status(400).json({ message: "Please write a short message before sending." });
  }
  if (message.length > MAX_MESSAGE) {
    return res.status(400).json({ message: `Message is too long (max ${MAX_MESSAGE} characters).` });
  }
  for (const [label, value] of [
    ["name", name],
    ["page", page],
  ] as const) {
    if (value !== undefined && (typeof value !== "string" || value.length > MAX_SHORT)) {
      return res.status(400).json({ message: `${label} must be a short text value` });
    }
  }

  const [row] = await db
    .insert(feedbackTable)
    .values({
      type: type as FeedbackType,
      message: message.trim(),
      name: typeof name === "string" && name.trim() !== "" ? name.trim() : null,
      page: typeof page === "string" && page.trim() !== "" ? page.trim() : null,
    })
    .returning();
  return res.status(201).json(serialize(row!));
});

export default router;
