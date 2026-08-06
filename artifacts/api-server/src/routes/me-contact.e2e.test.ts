// End-to-end tests for self-service contact updates (task: let each employee
// update their own phone and address from the mobile app).
//
// PATCH /me/contact is pinned to the session-resolved employee — the request
// never names a target row, so an employee can only ever edit themselves.
// Clerk is mocked at the @clerk/express boundary (never global fetch).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { vi } from "vitest";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import { db, pool, employeesTable } from "@workspace/db";

const mockState: { email: string | null } = { email: null };

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: () => (mockState.email ? { userId: "user_me_contact_e2e" } : null),
  clerkClient: {
    users: {
      getUser: async () => ({
        primaryEmailAddress: { emailAddress: mockState.email },
        emailAddresses: [{ emailAddress: mockState.email }],
      }),
      getUserList: async () => ({ data: [{ id: "user_me_contact_e2e" }] }),
      createUser: async () => ({ id: "user_me_contact_e2e" }),
    },
    sessions: {
      getSessionList: async () => ({ data: [] }),
      revokeSession: async () => ({}),
    },
  },
}));

const { default: app } = await import("../app");

let server: Server;
let baseUrl: string;

const SELF_ID = "e2e-me-contact-self";
const SELF_EMAIL = "me-contact-self-e2e@example.com";
const OTHER_ID = "e2e-me-contact-other";
const DISABLED_ID = "e2e-me-contact-disabled";
const DISABLED_EMAIL = "me-contact-disabled-e2e@example.com";

async function cleanup() {
  for (const id of [SELF_ID, OTHER_ID, DISABLED_ID]) {
    await db.delete(employeesTable).where(eq(employeesTable.id, id));
  }
}

beforeAll(async () => {
  await cleanup();
  await db.insert(employeesTable).values([
    { id: SELF_ID, name: "Me Contact Self E2E", role: "RN", email: SELF_EMAIL },
    {
      id: OTHER_ID,
      name: "Me Contact Other E2E",
      role: "PT",
      email: null,
      phone: "(208) 555-1111",
    },
    {
      id: DISABLED_ID,
      name: "Me Contact Disabled E2E",
      role: "OT",
      email: DISABLED_EMAIL,
      signInEnabled: false,
    },
  ]);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address();
  if (address == null || typeof address === "string") throw new Error("No server port");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await cleanup();
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await pool.end();
});

async function api(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json() };
}

describe("self-service contact updates (/me/contact)", () => {
  it("a signed-in employee can update their own contact details and see them on /me", async () => {
    mockState.email = SELF_EMAIL;
    const updated = await api("PATCH", "/me/contact", {
      phone: " (208) 555-2323 ",
      contactEmail: "My.Personal@Example.com",
      address: "789 Oak St\nBoise, ID 83702",
    });
    expect(updated.status).toBe(200);
    expect(updated.body.id).toBe(SELF_ID);
    expect(updated.body.phone).toBe("(208) 555-2323");
    expect(updated.body.contactEmail).toBe("my.personal@example.com");
    expect(updated.body.address).toBe("789 Oak St\nBoise, ID 83702");

    const me = await api("GET", "/me");
    expect(me.status).toBe(200);
    expect(me.body.phone).toBe("(208) 555-2323");
    expect(me.body.address).toBe("789 Oak St\nBoise, ID 83702");
  });

  it("only ever touches the session employee's own row", async () => {
    mockState.email = SELF_EMAIL;
    const updated = await api("PATCH", "/me/contact", { phone: "(208) 555-4444" });
    expect(updated.status).toBe(200);
    expect(updated.body.id).toBe(SELF_ID);

    // The other employee's row is untouched.
    const [other] = await db
      .select()
      .from(employeesTable)
      .where(eq(employeesTable.id, OTHER_ID));
    expect(other.phone).toBe("(208) 555-1111");
  });

  it("blank strings clear a field; omitted fields are unchanged", async () => {
    mockState.email = SELF_EMAIL;
    const cleared = await api("PATCH", "/me/contact", { contactEmail: "" });
    expect(cleared.status).toBe(200);
    expect(cleared.body.contactEmail).toBeUndefined();
    expect(cleared.body.phone).toBe("(208) 555-4444");
    expect(cleared.body.address).toBe("789 Oak St\nBoise, ID 83702");
  });

  it("rejects an invalid contact email and an empty update", async () => {
    mockState.email = SELF_EMAIL;
    const bad = await api("PATCH", "/me/contact", { contactEmail: "nope" });
    expect(bad.status).toBe(400);

    const empty = await api("PATCH", "/me/contact", {});
    expect(empty.status).toBe(400);
  });

  it("anonymous, unlinked, and disabled sessions cannot update contact details", async () => {
    mockState.email = null;
    const anon = await api("PATCH", "/me/contact", { phone: "555" });
    expect(anon.status).toBe(401);

    mockState.email = "not-on-roster-me-contact-e2e@example.com";
    const unknown = await api("PATCH", "/me/contact", { phone: "555" });
    expect(unknown.status).toBe(403);
    expect(unknown.body.code).toBe("NOT_LINKED");

    mockState.email = DISABLED_EMAIL;
    const disabled = await api("PATCH", "/me/contact", { phone: "555" });
    expect(disabled.status).toBe(403);
    expect(disabled.body.code).toBe("SIGN_IN_DISABLED");
  });
});
