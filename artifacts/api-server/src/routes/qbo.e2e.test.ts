import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import { db, qboConnectionTable } from "@workspace/db";

// The QBO admin endpoints (status/connect/invoice/disconnect/sent-invoices)
// are admin-only now, so this suite runs as Molly. The OAuth /qbo/callback is
// intentionally NOT admin-gated (Intuit calls it with no session) and behaves
// the same regardless of the session. Clerk is mocked at the @clerk/express
// boundary.
const mockState: { email: string | null } = { email: null };
vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: () => (mockState.email ? { userId: "user_qbo_e2e" } : null),
  clerkClient: {
    users: {
      getUser: async () => ({
        primaryEmailAddress: { emailAddress: mockState.email },
        emailAddresses: [{ emailAddress: mockState.email }],
      }),
      getUserList: async () => ({ data: [] }),
      createUser: async () => ({}),
    },
    sessions: { getSessionList: async () => ({ data: [] }), revokeSession: async () => ({}) },
  },
}));
const ADMIN_EMAIL = "admin-qbo-e2e@example.com";
process.env.ADMIN_EMAIL = ADMIN_EMAIL;
const { default: app } = await import("../app");

// These tests run without Intuit credentials and without a stored connection
// (except where a fake connection row is inserted), so no external calls to
// Intuit are made for the not-connected paths.

let server: Server;
let base: string;

beforeAll(async () => {
  // Admin endpoints below require Molly's session; the callback tests are
  // unaffected by it.
  mockState.email = ADMIN_EMAIL;
  // Ensure a clean slate and no accidental use of real credentials.
  delete process.env["QBO_CLIENT_ID"];
  delete process.env["QBO_CLIENT_SECRET"];
  // Pin the callback base URL so the surfaced redirect URI is deterministic
  // instead of depending on the ambient Replit domain env vars (which aren't
  // present under a bare `vitest` run). The missing-credentials paths still
  // fail on QBO_CLIENT_ID first, so this doesn't mask them.
  process.env["QBO_REDIRECT_BASE_URL"] = "https://qbo-e2e.example.com";
  await db.delete(qboConnectionTable).where(eq(qboConnectionTable.id, "singleton"));
  server = app.listen(0);
  const address = server.address();
  if (typeof address === "object" && address) {
    base = `http://127.0.0.1:${address.port}/api`;
  }
});

afterAll(async () => {
  delete process.env["QBO_REDIRECT_BASE_URL"];
  await db.delete(qboConnectionTable).where(eq(qboConnectionTable.id, "singleton"));
  await new Promise((resolve) => server.close(resolve));
});

describe("GET /qbo/status", () => {
  it("reports not configured and not connected when nothing is set up", async () => {
    const res = await fetch(`${base}/qbo/status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["configured"]).toBe(false);
    expect(body["connected"]).toBe(false);
    expect(body["companyName"]).toBeNull();
    // The exact redirect URI is surfaced so the Admin page can tell Molly
    // what to register in the Intuit developer portal.
    expect(String(body["callbackUrl"])).toMatch(/\/api\/qbo\/callback$/);
    // Tokens must never appear in the response.
    expect(JSON.stringify(body)).not.toMatch(/token/i);
  });

  it("reports which QuickBooks environment is active (sandbox vs production)", async () => {
    const prevEnv = process.env["QBO_ENV"];
    const prevDeploy = process.env["REPLIT_DEPLOYMENT"];
    try {
      // Sandbox in development: practice mode, but not the scary mismatch.
      process.env["QBO_ENV"] = "sandbox";
      delete process.env["REPLIT_DEPLOYMENT"];
      let body = (await (await fetch(`${base}/qbo/status`)).json()) as Record<string, unknown>;
      expect(body["environment"]).toBe("sandbox");
      expect(body["sandboxInProduction"]).toBe(false);

      // Sandbox while deployed: the dangerous combination gets flagged.
      process.env["REPLIT_DEPLOYMENT"] = "1";
      body = (await (await fetch(`${base}/qbo/status`)).json()) as Record<string, unknown>;
      expect(body["environment"]).toBe("sandbox");
      expect(body["sandboxInProduction"]).toBe(true);

      // Real mode: production environment, no flag even when deployed.
      delete process.env["QBO_ENV"];
      body = (await (await fetch(`${base}/qbo/status`)).json()) as Record<string, unknown>;
      expect(body["environment"]).toBe("production");
      expect(body["sandboxInProduction"]).toBe(false);
    } finally {
      if (prevEnv === undefined) delete process.env["QBO_ENV"];
      else process.env["QBO_ENV"] = prevEnv;
      if (prevDeploy === undefined) delete process.env["REPLIT_DEPLOYMENT"];
      else process.env["REPLIT_DEPLOYMENT"] = prevDeploy;
    }
  });

  it("reports an expired connection as not connected with a friendly note", async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000);
    await db.insert(qboConnectionTable).values({
      id: "singleton",
      realmId: "123",
      accessToken: "expired-access",
      refreshToken: "expired-refresh",
      accessTokenExpiresAt: past,
      refreshTokenExpiresAt: past,
      connectedAt: past,
      updatedAt: past,
    });
    try {
      const res = await fetch(`${base}/qbo/status`);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body["connected"]).toBe(false);
      expect(String(body["problem"])).toMatch(/connect again/i);
      expect(JSON.stringify(body)).not.toContain("expired-access");
      expect(JSON.stringify(body)).not.toContain("expired-refresh");
    } finally {
      await db.delete(qboConnectionTable).where(eq(qboConnectionTable.id, "singleton"));
    }
  });
});

describe("GET /qbo/connect", () => {
  it("explains missing credentials instead of redirecting", async () => {
    const res = await fetch(`${base}/qbo/connect`, { redirect: "manual" });
    expect(res.status).toBe(409);
    const text = await res.text();
    expect(text).toMatch(/set up/i);
  });
});

describe("GET /qbo/callback", () => {
  it("rejects a callback whose state doesn't match the cookie", async () => {
    const res = await fetch(`${base}/qbo/callback?code=abc&state=forged&realmId=1`, {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("quickbooks=error");
    // No connection may be created from a forged callback.
    const status = (await (await fetch(`${base}/qbo/status`)).json()) as Record<string, unknown>;
    expect(status["connected"]).toBe(false);
  });

  it("treats a user-cancelled consent screen as a calm cancellation", async () => {
    const res = await fetch(`${base}/qbo/callback?error=access_denied`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("quickbooks=cancelled");
  });
});

describe("POST /qbo/invoice", () => {
  const send = (body: unknown) =>
    fetch(`${base}/qbo/invoice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("rejects a missing clientId", async () => {
    const res = await send({ start: "2026-07-01", end: "2026-07-15" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toMatch(/clientId/);
  });

  it("rejects an invalid date range", async () => {
    const res = await send({ clientId: "c1", start: "2026-07-15", end: "2026-07-01" });
    expect(res.status).toBe(400);
  });

  it("blocks with a friendly message when QuickBooks is not connected", async () => {
    const res = await send({ clientId: "c1", start: "2026-07-01", end: "2026-07-15" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { message: string };
    expect(body.message).toMatch(/isn't connected/i);
    expect(body.message).toMatch(/connect/i);
  });

  it("blocks with 409 (not a crash) when the stored connection has expired", async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000);
    await db.insert(qboConnectionTable).values({
      id: "singleton",
      realmId: "123",
      accessToken: "expired-access",
      refreshToken: "expired-refresh",
      accessTokenExpiresAt: past,
      refreshTokenExpiresAt: past,
      connectedAt: past,
      updatedAt: past,
    });
    try {
      const res = await send({ clientId: "c1", start: "2026-07-01", end: "2026-07-15" });
      expect(res.status).toBe(409);
    } finally {
      await db.delete(qboConnectionTable).where(eq(qboConnectionTable.id, "singleton"));
    }
  });
});

describe("POST /qbo/disconnect", () => {
  it("succeeds when nothing is connected", async () => {
    const res = await fetch(`${base}/qbo/disconnect`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ disconnected: true });
  });

  it("deletes a stored connection", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    await db.insert(qboConnectionTable).values({
      id: "singleton",
      realmId: "123",
      accessToken: "some-access",
      refreshToken: "some-refresh",
      accessTokenExpiresAt: future,
      refreshTokenExpiresAt: future,
    });
    // No credentials configured, so no revoke call to Intuit happens.
    const res = await fetch(`${base}/qbo/disconnect`, { method: "POST" });
    expect(res.status).toBe(200);
    const rows = await db
      .select()
      .from(qboConnectionTable)
      .where(eq(qboConnectionTable.id, "singleton"));
    expect(rows).toHaveLength(0);
  });
});
