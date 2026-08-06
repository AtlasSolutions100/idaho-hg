import { Router, type IRouter, type Request } from "express";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, qboSentInvoicesTable, clientsTable, type QboSentInvoiceRow } from "@workspace/db";
import { logger } from "../lib/logger";
import {
  INTUIT_AUTHORIZE_URL,
  QBO_SCOPE,
  deleteConnection,
  exchangeCodeForTokens,
  fetchCompanyName,
  getConnection,
  getValidAccess,
  qboCredentials,
  revokeWithIntuit,
  saveConnection,
} from "../lib/qbo";
import {
  QboApiError,
  buildQboInvoicePayload,
  createQboInvoice,
  findOrCreateCustomer,
  findOrCreateItem,
} from "../lib/qbo-invoice";
import { computeInvoiceReport } from "../lib/invoice-report";

const router: IRouter = Router();

const STATE_COOKIE = "qbo_oauth_state";
const ADMIN_PATH = "/admin";

/**
 * Absolute callback URL on this app's own domain. Built only from trusted
 * environment configuration — never from request headers (header poisoning
 * would let an attacker steer the OAuth redirect). Resolution order:
 *   1. QBO_REDIRECT_BASE_URL (explicit override, e.g. the published domain)
 *   2. REPLIT_DOMAINS (first entry; the app's public domain, runtime-managed)
 *   3. REPLIT_DEV_DOMAIN (development preview domain, runtime-managed)
 * The exact same value must be registered in the Intuit developer app and is
 * used for both the authorize redirect and the token exchange.
 */
export function callbackBaseUrl(): string | null {
  const explicit = process.env["QBO_REDIRECT_BASE_URL"]?.trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  const domains = process.env["REPLIT_DOMAINS"]?.split(",")[0]?.trim();
  if (domains) return `https://${domains}`;
  const dev = process.env["REPLIT_DEV_DOMAIN"]?.trim();
  if (dev) return `https://${dev}`;
  return null;
}

function callbackUrl(): string | null {
  const base = callbackBaseUrl();
  return base ? `${base}/api/qbo/callback` : null;
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// ---- Start the OAuth flow: redirect Molly to Intuit's consent screen.
router.get("/qbo/connect", (_req, res) => {
  const creds = qboCredentials();
  if (!creds) {
    return res
      .status(409)
      .send("QuickBooks isn't set up yet — the Intuit app credentials are missing. Ask your developer to add them.");
  }
  const redirectUri = callbackUrl();
  if (!redirectUri) {
    return res
      .status(409)
      .send("QuickBooks isn't set up yet — the app's public web address isn't configured.");
  }
  const state = randomBytes(24).toString("hex");
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    // The trusted base URL is always https on Replit domains.
    secure: redirectUri.startsWith("https://"),
    maxAge: 10 * 60 * 1000,
    path: "/api/qbo",
  });
  const url = new URL(INTUIT_AUTHORIZE_URL);
  url.searchParams.set("client_id", creds.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", QBO_SCOPE);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return res.redirect(url.toString());
});

// ---- Intuit redirects back here after Molly approves (or cancels).
router.get("/qbo/callback", async (req, res) => {
  const back = (result: string) => res.redirect(`${ADMIN_PATH}?quickbooks=${result}`);

  const { code, state, realmId, error } = req.query as Record<string, string | undefined>;
  if (error) return back("cancelled");

  const expectedState = readCookie(req, STATE_COOKIE);
  res.clearCookie(STATE_COOKIE, { path: "/api/qbo" });
  if (!state || !expectedState || !safeEqual(state, expectedState)) {
    logger.warn("QuickBooks callback rejected: state mismatch");
    return back("error");
  }
  if (!code || !realmId) return back("error");

  const redirectUri = callbackUrl();
  if (!redirectUri) return back("error");

  try {
    const tokens = await exchangeCodeForTokens(code, redirectUri);
    await saveConnection(realmId, tokens);
    return back("connected");
  } catch (err) {
    logger.error({ err }, "QuickBooks token exchange failed");
    return back("error");
  }
});

// ---- Connection status (+ live company-name check when connected).
router.get("/qbo/status", async (_req, res) => {
  const configured = qboCredentials() !== null;
  const conn = await getConnection();
  if (!conn) {
    return res.json({ configured, connected: false, companyName: null, connectedAt: null, problem: null });
  }

  const access = await getValidAccess();
  if (!access) {
    return res.json({
      configured,
      connected: false,
      companyName: null,
      connectedAt: conn.connectedAt.toISOString(),
      problem: "The QuickBooks connection has expired or was revoked. Please connect again.",
    });
  }

  try {
    const companyName = await fetchCompanyName(access.accessToken, access.realmId);
    return res.json({
      configured,
      connected: true,
      companyName: companyName || null,
      connectedAt: conn.connectedAt.toISOString(),
      problem: null,
    });
  } catch (err) {
    logger.warn({ err }, "QuickBooks company info check failed");
    return res.json({
      configured,
      connected: true,
      companyName: null,
      connectedAt: conn.connectedAt.toISOString(),
      problem: "Connected, but QuickBooks couldn't be reached just now.",
    });
  }
});

/** Newest recorded send for a client + billing period, if any. */
async function latestRecordedSend(
  clientId: string,
  start: string,
  end: string,
): Promise<QboSentInvoiceRow | undefined> {
  const [row] = await db
    .select()
    .from(qboSentInvoicesTable)
    .where(
      and(
        eq(qboSentInvoicesTable.clientId, clientId),
        eq(qboSentInvoicesTable.periodStart, start),
        eq(qboSentInvoicesTable.periodEnd, end),
      ),
    )
    .orderBy(desc(qboSentInvoicesTable.sentAt))
    .limit(1);
  return row;
}

/** Calm 409 body telling Molly this invoice already went to QuickBooks. */
function alreadySentResponse(prior: QboSentInvoiceRow) {
  const sentOn = prior.sentAt.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  return {
    message: `It looks like this invoice was already sent to QuickBooks on ${sentOn}${prior.docNumber ? ` as invoice #${prior.docNumber}` : ""}. Sending again will create a second invoice in QuickBooks.`,
    alreadySent: true,
    previousSentAt: prior.sentAt.toISOString(),
    previousDocNumber: prior.docNumber,
    previousQboInvoiceId: prior.qboInvoiceId,
  };
}

// ---- Latest recorded send for a client + period, so the invoice screen can
// show "Sent to QuickBooks on … as invoice #…" before Molly clicks Send.
router.get("/qbo/sent-invoices", async (req, res, next) => {
  try {
    const { clientId, start, end } = req.query as Record<string, string | undefined>;
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    if (typeof clientId !== "string" || clientId.length === 0) {
      return res.status(400).json({ message: "Provide a clientId" });
    }
    if (
      typeof start !== "string" || typeof end !== "string" ||
      !DATE_RE.test(start) || !DATE_RE.test(end) || start > end
    ) {
      return res.status(400).json({ message: "Provide a valid date range (start <= end, YYYY-MM-DD)" });
    }
    const prior = await latestRecordedSend(clientId, start, end);
    if (!prior) {
      return res.json({ sent: false, sentAt: null, docNumber: null, qboInvoiceId: null });
    }
    return res.json({
      sent: true,
      sentAt: prior.sentAt.toISOString(),
      docNumber: prior.docNumber,
      qboInvoiceId: prior.qboInvoiceId,
    });
  } catch (err) {
    return next(err);
  }
});

// ---- Send an invoice into QuickBooks as a draft (unsent) invoice.
router.post("/qbo/invoice", async (req, res, next) => {
  try {
    const { clientId, start, end, confirmDuplicate } = (req.body ?? {}) as Record<string, unknown>;
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    if (typeof clientId !== "string" || clientId.length === 0) {
      return res.status(400).json({ message: "Provide a clientId" });
    }
    if (
      typeof start !== "string" || typeof end !== "string" ||
      !DATE_RE.test(start) || !DATE_RE.test(end) || start > end
    ) {
      return res.status(400).json({ message: "Provide a valid date range (start <= end, YYYY-MM-DD)" });
    }

    // Practice (demo) clients never touch QuickBooks — nothing real should
    // ever be created from practice data, and their local sent-invoice
    // records are removed with the rest of the demo data.
    const [clientRow] = await db
      .select({ isDemo: clientsTable.isDemo })
      .from(clientsTable)
      .where(eq(clientsTable.id, clientId));
    if (clientRow?.isDemo) {
      return res.status(400).json({
        message:
          "Demo clients can't be sent to QuickBooks. Practice invoices stay inside the app — use a real client for actual billing.",
      });
    }

    // Warn about a repeat send before anything else — even before checking
    // the connection — so Molly hears about it as early as possible. A
    // confirmed re-send (confirmDuplicate: true) skips the warning.
    const confirmed = confirmDuplicate === true;
    if (!confirmed) {
      const prior = await latestRecordedSend(clientId, start, end);
      if (prior) return res.status(409).json(alreadySentResponse(prior));
    }

    const access = await getValidAccess();
    if (!access) {
      return res.status(409).json({
        message: "QuickBooks isn't connected. Connect QuickBooks on the Admin dashboard first, then try again.",
      });
    }

    // Rebuild the invoice from the database so what lands in QuickBooks is
    // exactly what the report shows — the browser never supplies amounts.
    const report = await computeInvoiceReport(clientId, start, end);
    if (!report) return res.status(404).json({ message: "Client not found" });
    if (report.lines.length === 0) {
      return res.status(400).json({
        message: "There's nothing to send — no approved billable entries for this client in that period.",
      });
    }

    // Resolve the customer and one service item per "Product or service"
    // name. These are find-or-create lookups (idempotent); the invoice itself
    // is created in a single call afterwards, so a failure never leaves a
    // half-created invoice behind.
    const customerRef = await findOrCreateCustomer(access, report.clientName);
    const itemNames = [...new Set(report.lines.map((l) => l.productService))];
    const itemRefsByName = new Map<string, { value: string; name?: string }>();
    for (const name of itemNames) {
      itemRefsByName.set(name, await findOrCreateItem(access, name));
    }

    const payload = buildQboInvoicePayload({
      customerRef,
      lines: report.lines,
      itemRefsByName,
      txnDate: report.end,
      periodStart: report.start,
      periodEnd: report.end,
    });
    // Send and record inside one transaction holding an advisory lock keyed
    // on client + period, so two rapid/parallel sends serialize: the second
    // waits, then sees the first send's row and gets the warning instead of
    // silently creating a duplicate. (Holding the transaction across the QBO
    // call is fine here — this is a single-user, low-traffic flow.)
    const outcome = await db.transaction(
      async (tx): Promise<{ duplicate: QboSentInvoiceRow } | { invoice: Awaited<ReturnType<typeof createQboInvoice>> }> => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`qbo_invoice_send:${clientId}:${start}:${end}`}))`,
      );
      if (!confirmed) {
        const [prior] = await tx
          .select()
          .from(qboSentInvoicesTable)
          .where(
            and(
              eq(qboSentInvoicesTable.clientId, clientId),
              eq(qboSentInvoicesTable.periodStart, start),
              eq(qboSentInvoicesTable.periodEnd, end),
            ),
          )
          .orderBy(desc(qboSentInvoicesTable.sentAt))
          .limit(1);
        if (prior) return { duplicate: prior } as const;
      }
      const invoice = await createQboInvoice(access, payload);
      await tx.insert(qboSentInvoicesTable).values({
        id: randomUUID(),
        clientId,
        periodStart: start,
        periodEnd: end,
        qboInvoiceId: invoice.id,
        docNumber: invoice.docNumber,
      });
      return { invoice } as const;
    });
    if ("duplicate" in outcome) {
      return res.status(409).json(alreadySentResponse(outcome.duplicate));
    }
    const invoice = outcome.invoice;

    logger.info(
      { clientId, start, end, qboInvoiceId: invoice.id, docNumber: invoice.docNumber },
      "Invoice sent to QuickBooks",
    );
    return res.json({
      qboInvoiceId: invoice.id,
      docNumber: invoice.docNumber,
      customerName: customerRef.name ?? report.clientName,
      lineCount: report.lines.length,
      total: report.total,
    });
  } catch (err) {
    if (err instanceof QboApiError) {
      logger.warn({ err }, "QuickBooks rejected the invoice send");
      return res.status(502).json({
        message: "QuickBooks rejected the request, so nothing was created. Please try again — if it keeps failing, reconnect QuickBooks.",
      });
    }
    return next(err);
  }
});

// ---- Disconnect: revoke with Intuit, then delete our stored tokens.
router.post("/qbo/disconnect", async (_req, res) => {
  const conn = await getConnection();
  if (conn) {
    try {
      await revokeWithIntuit(conn.refreshToken);
    } catch (err) {
      logger.warn({ err }, "Intuit token revoke failed; deleting local tokens anyway");
    }
    await deleteConnection();
  }
  return res.json({ disconnected: true });
});

export default router;
