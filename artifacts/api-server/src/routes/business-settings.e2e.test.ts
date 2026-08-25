import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import { db, businessSettingsTable } from "@workspace/db";

// Business settings (GET/PUT) and invoice-number allocation are admin-only, so
// this suite runs as Molly. Clerk is mocked at the @clerk/express boundary.
const mockState: { email: string | null } = { email: null };
vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: () => (mockState.email ? { userId: "user_business_settings_e2e" } : null),
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
const ADMIN_EMAIL = "admin-business-settings-e2e@example.com";
process.env.ADMIN_EMAIL = ADMIN_EMAIL;
const { default: app } = await import("../app");

// This suite owns the singleton settings row: it snapshots whatever is stored
// before the run and restores it afterwards, so it can assert exact values.
let server: Server;
let base: string;
let savedRow: typeof businessSettingsTable.$inferSelect | undefined;

beforeAll(async () => {
  // Every endpoint here is admin-only now; act as Molly for the whole suite.
  mockState.email = ADMIN_EMAIL;
  [savedRow] = await db
    .select()
    .from(businessSettingsTable)
    .where(eq(businessSettingsTable.id, "singleton"));
  server = app.listen(0);
  const address = server.address();
  if (typeof address === "object" && address) {
    base = `http://127.0.0.1:${address.port}/api`;
  }
});

afterAll(async () => {
  await db.delete(businessSettingsTable).where(eq(businessSettingsTable.id, "singleton"));
  if (savedRow) {
    await db.insert(businessSettingsTable).values(savedRow);
  }
  await new Promise((resolve) => server.close(resolve));
});

describe("business settings + invoice numbering", () => {
  it("returns defaults before anything is saved", async () => {
    await db.delete(businessSettingsTable).where(eq(businessSettingsTable.id, "singleton"));
    const res = await fetch(`${base}/business-settings`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      address: "",
      phone: "",
      email: "",
      paymentTerms: "",
      nextInvoiceNumber: 1,
    });
  });

  it("saves and returns business details", async () => {
    const res = await fetch(`${base}/business-settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: "123 Main St\nBoise, ID 83702",
        phone: "(208) 555-0100",
        email: "billing@hodge.example",
        paymentTerms: "Net 30",
        nextInvoiceNumber: 100,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      address: "123 Main St\nBoise, ID 83702",
      phone: "(208) 555-0100",
      email: "billing@hodge.example",
      paymentTerms: "Net 30",
      nextInvoiceNumber: 100,
    });

    const roundTrip = await fetch(`${base}/business-settings`);
    expect(await roundTrip.json()).toEqual(body);
  });

  it("partially updates without clobbering other fields", async () => {
    const res = await fetch(`${base}/business-settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "(208) 555-0199" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { phone: string; email: string; nextInvoiceNumber: number };
    expect(body.phone).toBe("(208) 555-0199");
    expect(body.email).toBe("billing@hodge.example");
    expect(body.nextInvoiceNumber).toBe(100);
  });

  it("rejects invalid values", async () => {
    for (const bad of [
      { nextInvoiceNumber: 0 },
      { nextInvoiceNumber: 2.5 },
      { nextInvoiceNumber: "7" },
      { email: 42 },
      { address: "x".repeat(501) },
    ]) {
      const res = await fetch(`${base}/business-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bad),
      });
      expect(res.status).toBe(400);
    }
  });

  it("allocates sequential invoice numbers and advances the counter", async () => {
    const first = await fetch(`${base}/business-settings/next-invoice-number`, { method: "POST" });
    expect(first.status).toBe(200);
    const a = (await first.json()) as { invoiceNumber: number };
    expect(a.invoiceNumber).toBe(100);

    const second = await fetch(`${base}/business-settings/next-invoice-number`, { method: "POST" });
    const b = (await second.json()) as { invoiceNumber: number };
    expect(b.invoiceNumber).toBe(101);

    const settings = await fetch(`${base}/business-settings`);
    const body = (await settings.json()) as { nextInvoiceNumber: number };
    expect(body.nextInvoiceNumber).toBe(102);
  });

  it("allocates from a fresh database starting at 1", async () => {
    await db.delete(businessSettingsTable).where(eq(businessSettingsTable.id, "singleton"));
    const res = await fetch(`${base}/business-settings/next-invoice-number`, { method: "POST" });
    const body = (await res.json()) as { invoiceNumber: number };
    expect(body.invoiceNumber).toBe(1);

    const settings = await fetch(`${base}/business-settings`);
    expect(((await settings.json()) as { nextInvoiceNumber: number }).nextInvoiceNumber).toBe(2);
  });

  it("never hands out duplicate numbers under concurrent requests", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        fetch(`${base}/business-settings/next-invoice-number`, { method: "POST" }).then(
          async (r) => ((await r.json()) as { invoiceNumber: number }).invoiceNumber,
        ),
      ),
    );
    expect(new Set(results).size).toBe(10);
  });
});
