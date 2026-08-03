import { Router, type IRouter, type Request } from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
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
