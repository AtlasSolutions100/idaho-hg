// Drive time only bills alongside Hospital at Home or hospice work.
//
// Molly, 11 Sep 2026: "we are not able to bill for drive time to st Lukes
// unless its related to hospital at home (HAH) or Hospice." Billing it on any
// other day puts a line on the invoice that St. Luke's will reject, so the
// line has to appear at $0 with the reason — visible to Molly, not silently
// dropped, and not mixed in with rates she simply hasn't set.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "node:http";
import { inArray } from "drizzle-orm";
import { db, pool, timeEntriesTable } from "@workspace/db";

const ADMIN_EMAIL = "admin-drivetime-e2e@example.com";
process.env.ADMIN_EMAIL = ADMIN_EMAIL;
const mockSession: { email: string | null } = { email: ADMIN_EMAIL };

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: () => (mockSession.email ? { userId: "user_drivetime_e2e" } : null),
  clerkClient: {
    users: {
      getUser: async () => ({
        primaryEmailAddress: { emailAddress: mockSession.email },
        emailAddresses: [{ emailAddress: mockSession.email }],
      }),
      getUserList: async () => ({ data: [{ id: "user_drivetime_e2e" }] }),
      createUser: async () => ({ id: "user_drivetime_e2e" }),
    },
    sessions: {
      getSessionList: async () => ({ data: [] }),
      revokeSession: async () => ({}),
    },
  },
}));

import app from "../app";

let server: Server;
let baseUrl: string;

const ST_LUKES = "1";
const RN = "e2ae91e4-d3d8-4447-b4ce-85de035b6700"; // Adrian Eddins, RN (seeded)
// May 2030 is used by no other e2e file; both dates below are plain weekdays.
const START = "2030-05-01";
const END = "2030-05-31";
const ALONE = "2030-05-07"; // drive time with nothing to attach to
const WITH_WORK = "2030-05-08"; // drive time alongside Hospital at Home

const createdIds: number[] = [];

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** File an entry as Molly and approve it so it reaches the reports. */
async function approved(body: Record<string, unknown>) {
  const created = await api("/time-entries", {
    method: "POST",
    body: JSON.stringify({ employeeId: RN, clientId: ST_LUKES, ...body }),
  });
  expect(created.status).toBe(201);
  createdIds.push(Number(created.body.id));
  const ok = await api(`/time-entries/${created.body.id}/approve`, { method: "POST" });
  expect(ok.status).toBe(200);
  return created.body;
}

const invoice = () =>
  api(`/reports/invoice?clientId=${ST_LUKES}&start=${START}&end=${END}`);
const reconciliation = () =>
  api(`/reports/reconciliation?clientId=${ST_LUKES}&start=${START}&end=${END}`);

const driveLine = (lines: any[]) =>
  lines.find((l: any) => l.description?.includes("Drive time"));

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address();
  if (address == null || typeof address === "string") throw new Error("No server port");
  baseUrl = `http://127.0.0.1:${address.port}`;
  await api("/visit-types"); // force seeding before anything asserts on it
});

afterAll(async () => {
  if (createdIds.length > 0) {
    await db.delete(timeEntriesTable).where(inArray(timeEntriesTable.id, createdIds));
  }
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await pool.end();
});

describe("drive time billing", () => {
  it("shows drive time at $0 with the reason when nothing on that day earns it", async () => {
    await approved({ date: ALONE, visitType: "drive-time", quantity: 2 });

    const res = await invoice();
    expect(res.status).toBe(200);
    const line = driveLine(res.body.lines);
    expect(line).toBeTruthy();
    // The work is still shown — half an hour of it — just not charged for.
    expect(line.qty).toBe(0.5);
    expect(line.amount).toBe(0);
    expect(line.note).toContain("Hospital at Home");
    // And it is not a rate Molly forgot to set, so it must not be counted
    // among the rates she is told to go and fix.
    expect(line.missingRate).toBe(false);
    expect(res.body.missingRateCount).toBe(0);
  });

  it("reconciliation agrees with the invoice, which is the whole point of it", async () => {
    const [inv, rec] = await Promise.all([invoice(), reconciliation()]);
    const recLines = rec.body.employees.flatMap((e: any) => e.lines ?? []);
    const recDrive = recLines.find((l: any) => l.visitType === "drive-time");
    expect(recDrive).toBeTruthy();
    expect(recDrive.amount).toBe(0);
    expect(inv.body.total).toBe(0);
  });

  it("bills drive time when the day carries Hospital at Home work", async () => {
    await approved({ date: WITH_WORK, visitType: "hospital-at-home", quantity: 4 });
    await approved({ date: WITH_WORK, visitType: "drive-time", quantity: 2 });

    const res = await invoice();
    const lines = res.body.lines.filter((l: any) => l.description?.includes("Drive time"));
    // Two drive-time lines now: the refused day and the earned one, kept
    // apart so the unbillable half hour can't hide inside a billed line.
    expect(lines).toHaveLength(2);
    const billed = lines.find((l: any) => l.amount > 0);
    expect(billed.qty).toBe(0.5);
    expect(billed.rate).toBe(84);
    expect(billed.amount).toBeCloseTo(42, 2);
    expect(billed.note).toBeUndefined();

    const refused = lines.find((l: any) => l.amount === 0);
    expect(refused.note).toContain("Hospital at Home");
  });

  it("hospice earns it too, not just Hospital at Home", async () => {
    const day = "2030-05-14";
    await approved({ date: day, visitType: "hospice", quantity: 4 });
    await approved({ date: day, visitType: "drive-time", quantity: 4 });

    const res = await invoice();
    const billedHours = res.body.lines
      .filter((l: any) => l.description?.includes("Drive time") && l.amount > 0)
      .reduce((sum: number, l: any) => sum + l.qty, 0);
    // The half hour from the Hospital at Home day plus a full hour here.
    expect(billedHours).toBeCloseTo(1.5, 2);
  });
});
