// On-call and call-back hours at Idaho Youth Ranch.
//
// Molly, 11 Sep 2026: "On call is by the hour... minimum hours is 4 for this
// contract. Call back rate is same as the hourly rate ($93/hr)." Idaho Youth
// Ranch is an hourly client — it rejects visit types outright — so the kind of
// hours rides on the entry, and the rates resolve through the same per-client
// machinery the ordinary hourly rate already uses.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "node:http";
import { inArray } from "drizzle-orm";
import { db, pool, timeEntriesTable } from "@workspace/db";

const ADMIN_EMAIL = "admin-oncall-e2e@example.com";
process.env.ADMIN_EMAIL = ADMIN_EMAIL;
const mockSession: { email: string | null } = { email: ADMIN_EMAIL };

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: () => (mockSession.email ? { userId: "user_oncall_e2e" } : null),
  clerkClient: {
    users: {
      getUser: async () => ({
        primaryEmailAddress: { emailAddress: mockSession.email },
        emailAddresses: [{ emailAddress: mockSession.email }],
      }),
      getUserList: async () => ({ data: [{ id: "user_oncall_e2e" }] }),
      createUser: async () => ({ id: "user_oncall_e2e" }),
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

const YOUTH_RANCH = "3";
const RN = "0b970f7e-1788-4b52-be50-811ad8ce9b9a"; // Bree Whiting, RN (seeded)
// June 2030 is used by no other e2e file.
const START = "2030-06-01";
const END = "2030-06-30";

const createdIds: number[] = [];

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function approved(body: Record<string, unknown>) {
  const created = await api("/time-entries", {
    method: "POST",
    body: JSON.stringify({ employeeId: RN, clientId: YOUTH_RANCH, ...body }),
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  createdIds.push(Number(created.body.id));
  const ok = await api(`/time-entries/${created.body.id}/approve`, { method: "POST" });
  expect(ok.status).toBe(200);
  return created.body;
}

const invoice = () =>
  api(`/reports/invoice?clientId=${YOUTH_RANCH}&start=${START}&end=${END}`);
const payroll = () => api(`/reports/payroll?start=${START}&end=${END}`);

const lineMatching = (lines: any[], text: string) =>
  lines.find((l: any) => l.description?.includes(text));

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address();
  if (address == null || typeof address === "string") throw new Error("No server port");
  baseUrl = `http://127.0.0.1:${address.port}`;
  await api("/clients"); // force seeding before anything asserts on rates
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

describe("on-call and call-back hours", () => {
  it("bills on-call by the hour at its own rate, not the worked rate", async () => {
    await approved({ date: "2030-06-03", timeIn: "08:00", timeOut: "20:00", hourKind: "on-call" });

    const res = await invoice();
    expect(res.status).toBe(200);
    const line = lineMatching(res.body.lines, "on call");
    expect(line).toBeTruthy();
    expect(line.qty).toBe(12);
    expect(line.rate).toBe(40);
    expect(line.amount).toBeCloseTo(480, 2);
  });

  it("pays on-call at the per-client pay rate, which differs from the bill rate", async () => {
    const res = await payroll();
    const emp = res.body.employees.find((e: any) => e.employeeId === RN);
    const line = emp.lines.find((l: any) => l.hours === 12);
    // $20/hr paid against $40/hr billed — the whole reason on-call needs its
    // own rate rather than reusing the worked-hours rate.
    expect(line.basePay).toBeCloseTo(240, 2);
  });

  it("pays and bills a short call-back for the contract's four hours", async () => {
    await approved({ date: "2030-06-05", timeIn: "22:00", timeOut: "23:30", hourKind: "call-back" });

    const inv = await invoice();
    const line = lineMatching(inv.body.lines, "call back");
    expect(line).toBeTruthy();
    // Ninety minutes of work, four hours of money, at the ordinary $93 rate.
    expect(line.qty).toBe(4);
    expect(line.rate).toBe(93);
    expect(line.amount).toBeCloseTo(372, 2);

    const pay = await payroll();
    const emp = pay.body.employees.find((e: any) => e.employeeId === RN);
    const payLine = emp.lines.find((l: any) => l.date === "2030-06-05");
    expect(payLine.hours).toBe(4);
    expect(payLine.basePay).toBeCloseTo(284, 2); // 4 x $71
  });

  it("leaves ordinary worked hours on their own line at the worked rate", async () => {
    await approved({ date: "2030-06-10", timeIn: "08:00", timeOut: "20:00" });

    const res = await invoice();
    const worked = lineMatching(res.body.lines, "hourly");
    expect(worked.qty).toBe(12);
    expect(worked.rate).toBe(93);
    // Three distinct kinds, three distinct lines — never merged.
    const kinds = res.body.lines.filter((l: any) => l.kind === "hourly");
    expect(kinds).toHaveLength(3);
  });

  it("shows Molly the call-back minimum and lets her change it", async () => {
    // The minimum was being priced from without ever being served, so the
    // contract term that decides what a call-back costs could be neither seen
    // nor corrected from the app.
    const before = (await api("/clients")).body.find((c: any) => c.id === YOUTH_RANCH);
    expect(before.callBackMinimumHours).toBe(4);

    // Send the billing fields back unchanged: this endpoint clears them when
    // they are left out.
    const keep = {
      billingContact: before.billingContact ?? "",
      billingAddress: before.billingAddress ?? "",
    };
    const changed = await api(`/clients/${YOUTH_RANCH}`, {
      method: "PATCH",
      body: JSON.stringify({ ...keep, callBackMinimumHours: 6 }),
    });
    expect(changed.status).toBe(200);
    expect(changed.body.callBackMinimumHours).toBe(6);

    const restored = await api(`/clients/${YOUTH_RANCH}`, {
      method: "PATCH",
      body: JSON.stringify({ ...keep, callBackMinimumHours: 4 }),
    });
    expect(restored.body.callBackMinimumHours).toBe(4);
  });

  it("refuses on-call on a visit entry, which is not a kind of hours", async () => {
    const res = await api("/time-entries", {
      method: "POST",
      body: JSON.stringify({
        employeeId: RN,
        clientId: YOUTH_RANCH,
        date: "2030-06-12",
        visitType: "skilled-nursing",
        hourKind: "on-call",
      }),
    });
    expect(res.status).toBe(400);
  });
});
