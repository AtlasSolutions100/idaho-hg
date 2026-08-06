import { eq, sql } from "drizzle-orm";
import { db, qboConnectionTable } from "@workspace/db";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// QuickBooks Online OAuth 2.0 helpers (Intuit).
// Tokens live only in the database and this process — never in responses.
// ---------------------------------------------------------------------------

export const QBO_SINGLETON_ID = "singleton";

export const INTUIT_AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
export const INTUIT_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
export const INTUIT_REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
export const QBO_SCOPE = "com.intuit.quickbooks.accounting";

export function qboCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env["QBO_CLIENT_ID"]?.trim();
  const clientSecret = process.env["QBO_CLIENT_SECRET"]?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/** True when the server talks to Intuit's harmless sandbox environment. */
export function isQboSandbox(): boolean {
  return process.env["QBO_ENV"]?.trim().toLowerCase() === "sandbox";
}

/** Company API base — sandbox vs production, controlled by QBO_ENV (default production). */
export function qboApiBase(): string {
  return isQboSandbox()
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  x_refresh_token_expires_in: number; // seconds
}

async function requestTokens(params: URLSearchParams): Promise<TokenResponse> {
  const creds = qboCredentials();
  if (!creds) throw new Error("QuickBooks credentials are not configured");
  const res = await fetch(INTUIT_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(creds.clientId, creds.clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: params.toString(),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Intuit token request failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<TokenResponse> {
  return requestTokens(
    new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  );
}

async function refreshTokens(refreshToken: string): Promise<TokenResponse> {
  return requestTokens(new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }));
}

export async function saveConnection(realmId: string, tokens: TokenResponse): Promise<void> {
  const now = Date.now();
  const values = {
    id: QBO_SINGLETON_ID,
    realmId,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    accessTokenExpiresAt: new Date(now + tokens.expires_in * 1000),
    refreshTokenExpiresAt: new Date(now + tokens.x_refresh_token_expires_in * 1000),
    connectedAt: new Date(now),
    updatedAt: new Date(now),
  };
  await db
    .insert(qboConnectionTable)
    .values(values)
    .onConflictDoUpdate({
      target: qboConnectionTable.id,
      set: { ...values, id: undefined as never },
    });
}

export async function getConnection() {
  const [row] = await db
    .select()
    .from(qboConnectionTable)
    .where(eq(qboConnectionTable.id, QBO_SINGLETON_ID));
  return row ?? null;
}

export async function deleteConnection(): Promise<void> {
  await db.delete(qboConnectionTable).where(eq(qboConnectionTable.id, QBO_SINGLETON_ID));
}

/**
 * Returns a valid access token + realm id, refreshing with Intuit when the
 * access token is near expiry. Returns null when there is no usable
 * connection (never connected, or the refresh token expired/was revoked).
 */
export async function getValidAccess(): Promise<{ accessToken: string; realmId: string } | null> {
  const conn = await getConnection();
  if (!conn) return null;

  const now = Date.now();
  // Refresh when within 5 minutes of expiry.
  if (conn.accessTokenExpiresAt.getTime() - now > 5 * 60 * 1000) {
    return { accessToken: conn.accessToken, realmId: conn.realmId };
  }
  if (conn.refreshTokenExpiresAt.getTime() <= now) return null;

  // Serialize refreshes: Intuit rotates the refresh token on every refresh,
  // so two concurrent refreshes with the same old token can leave one caller
  // failing spuriously. An advisory transaction lock makes the second caller
  // wait, re-read the row, and reuse the fresh token instead of refreshing.
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('qbo_connection_refresh'))`);
      const [current] = await tx
        .select()
        .from(qboConnectionTable)
        .where(eq(qboConnectionTable.id, QBO_SINGLETON_ID));
      if (!current) return null;
      if (current.accessTokenExpiresAt.getTime() - Date.now() > 5 * 60 * 1000) {
        // Another request already refreshed while we waited for the lock.
        return { accessToken: current.accessToken, realmId: current.realmId };
      }
      const tokens = await refreshTokens(current.refreshToken);
      const nowMs = Date.now();
      await tx
        .update(qboConnectionTable)
        .set({
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          accessTokenExpiresAt: new Date(nowMs + tokens.expires_in * 1000),
          refreshTokenExpiresAt: new Date(nowMs + tokens.x_refresh_token_expires_in * 1000),
          updatedAt: new Date(nowMs),
        })
        .where(eq(qboConnectionTable.id, QBO_SINGLETON_ID));
      return { accessToken: tokens.access_token, realmId: current.realmId };
    });
  } catch (err) {
    logger.warn({ err }, "QuickBooks token refresh failed");
    return null;
  }
}

/** Fetch the company name from QuickBooks CompanyInfo (proves the connection works). */
export async function fetchCompanyName(accessToken: string, realmId: string): Promise<string> {
  const url = `${qboApiBase()}/v3/company/${encodeURIComponent(realmId)}/companyinfo/${encodeURIComponent(realmId)}?minorversion=75`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`QuickBooks CompanyInfo request failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { CompanyInfo?: { CompanyName?: string } };
  return data.CompanyInfo?.CompanyName ?? "";
}

export async function revokeWithIntuit(refreshToken: string): Promise<void> {
  const creds = qboCredentials();
  if (!creds) return; // Nothing we can do; local deletion still proceeds.
  const res = await fetch(INTUIT_REVOKE_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(creds.clientId, creds.clientSecret),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ token: refreshToken }),
  });
  // Intuit returns 200 on success; treat failures as non-fatal (we still
  // delete our copy) but log them.
  if (!res.ok) {
    logger.warn({ status: res.status }, "Intuit token revoke returned non-OK status");
  }
}
