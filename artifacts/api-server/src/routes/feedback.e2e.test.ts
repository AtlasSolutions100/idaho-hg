import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { inArray } from "drizzle-orm";
import { db, feedbackTable } from "@workspace/db";
import app from "../app";

const runTag = `e2e-feedback-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let server: Server;
let base: string;
const createdIds: number[] = [];

beforeAll(async () => {
  server = app.listen(0);
  const address = server.address();
  if (typeof address === "object" && address) {
    base = `http://127.0.0.1:${address.port}/api`;
  }
});

afterAll(async () => {
  if (createdIds.length > 0) {
    await db.delete(feedbackTable).where(inArray(feedbackTable.id, createdIds));
  }
  await new Promise((resolve) => server.close(resolve));
});

describe("POST /feedback + GET /feedback", () => {
  it("saves feedback and lists it newest first", async () => {
    const first = await fetch(`${base}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "problem",
        message: `The reports page froze (${runTag})`,
        name: "Molly",
        page: "/admin/reports",
      }),
    });
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { id: number; createdAt: string };
    createdIds.push(firstBody.id);
    expect(firstBody).toMatchObject({
      type: "problem",
      message: `The reports page froze (${runTag})`,
      name: "Molly",
      page: "/admin/reports",
    });
    expect(typeof firstBody.createdAt).toBe("string");

    const second = await fetch(`${base}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "idea", message: `Weekly email summary (${runTag})` }),
    });
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as { id: number };
    createdIds.push(secondBody.id);
    // Optional fields are omitted, not null.
    expect("name" in secondBody).toBe(false);

    const list = await fetch(`${base}/feedback`);
    expect(list.status).toBe(200);
    const rows = (await list.json()) as { id: number; message: string }[];
    const mine = rows.filter((r) => r.message.includes(runTag));
    expect(mine.map((r) => r.id)).toEqual([secondBody.id, firstBody.id]);
  });

  it("rejects empty messages and unknown types", async () => {
    const empty = await fetch(`${base}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "idea", message: "   " }),
    });
    expect(empty.status).toBe(400);

    const badType = await fetch(`${base}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "rant", message: "hello" }),
    });
    expect(badType.status).toBe(400);

    const tooLong = await fetch(`${base}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "other", message: "x".repeat(5001) }),
    });
    expect(tooLong.status).toBe(400);
  });
});
