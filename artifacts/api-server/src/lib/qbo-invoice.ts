// Sending an invoice into QuickBooks Online.
//
// Split in two layers:
//  - buildQboInvoicePayload: pure mapping from our invoice lines to the QBO
//    Invoice create body (unit tested without any network/database).
//  - qboQuery / findOrCreateCustomer / findOrCreateItem / createQboInvoice:
//    thin wrappers over the QBO v3 REST API.
//
// Atomicity: the invoice itself is created in a single QBO API call, so a
// failed send never half-creates an invoice. Customers and service items are
// find-or-create lookups that may exist after a failed attempt — that's safe
// (they're reused on retry, never duplicated: we always look up by name first).

import { logger } from "./logger";
import { qboApiBase } from "./qbo";
import type { InvoiceLine } from "./invoice-lines";

const MINOR_VERSION = "75";

export class QboApiError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(`QuickBooks API error (${status}): ${detail}`);
    this.status = status;
    this.detail = detail;
  }
}

type Access = { accessToken: string; realmId: string };

async function qboFetch(access: Access, path: string, init?: RequestInit): Promise<unknown> {
  const url = `${qboApiBase()}/v3/company/${encodeURIComponent(access.realmId)}${path}${path.includes("?") ? "&" : "?"}minorversion=${MINOR_VERSION}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${access.accessToken}`,
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new QboApiError(res.status, body.slice(0, 500));
  }
  return res.json();
}

/** Run a QBO SQL-ish query (SELECT ...). */
async function qboQuery(access: Access, query: string): Promise<Record<string, unknown>> {
  const data = (await qboFetch(access, `/query?query=${encodeURIComponent(query)}`)) as {
    QueryResponse?: Record<string, unknown>;
  };
  return data.QueryResponse ?? {};
}

/** Escape a value for inclusion in a QBO query string literal. */
function escapeQbo(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

type Ref = { value: string; name?: string };

/** Find a QBO customer by display name, creating it when missing. */
export async function findOrCreateCustomer(access: Access, name: string): Promise<Ref> {
  const qr = await qboQuery(
    access,
    `select Id, DisplayName from Customer where DisplayName = '${escapeQbo(name)}'`,
  );
  const existing = (qr["Customer"] as Array<{ Id: string; DisplayName: string }> | undefined)?.[0];
  if (existing) return { value: existing.Id, name: existing.DisplayName };

  const created = (await qboFetch(access, "/customer", {
    method: "POST",
    body: JSON.stringify({ DisplayName: name }),
  })) as { Customer?: { Id: string; DisplayName: string } };
  if (!created.Customer) throw new Error("QuickBooks did not return the created customer");
  logger.info({ name }, "Created QuickBooks customer");
  return { value: created.Customer.Id, name: created.Customer.DisplayName };
}

let cachedIncomeAccountId: string | null = null;

/** First income account in the company — needed to create service items. */
async function getIncomeAccountId(access: Access): Promise<string> {
  if (cachedIncomeAccountId) return cachedIncomeAccountId;
  const qr = await qboQuery(
    access,
    "select Id, Name from Account where AccountType = 'Income' maxresults 1",
  );
  const account = (qr["Account"] as Array<{ Id: string }> | undefined)?.[0];
  if (!account) {
    throw new Error("No income account found in QuickBooks — add one in QuickBooks first");
  }
  cachedIncomeAccountId = account.Id;
  return account.Id;
}

/** For tests: clear the module-level income-account cache. */
export function resetQboInvoiceCache(): void {
  cachedIncomeAccountId = null;
}

/**
 * Find a QBO service item by name (our "Product or service" column, e.g.
 * "Clark, Molly RN"), creating it when missing.
 */
export async function findOrCreateItem(access: Access, name: string): Promise<Ref> {
  const qr = await qboQuery(
    access,
    `select Id, Name from Item where Name = '${escapeQbo(name)}'`,
  );
  const existing = (qr["Item"] as Array<{ Id: string; Name: string }> | undefined)?.[0];
  if (existing) return { value: existing.Id, name: existing.Name };

  const incomeAccountId = await getIncomeAccountId(access);
  const created = (await qboFetch(access, "/item", {
    method: "POST",
    body: JSON.stringify({
      Name: name,
      Type: "Service",
      IncomeAccountRef: { value: incomeAccountId },
    }),
  })) as { Item?: { Id: string; Name: string } };
  if (!created.Item) throw new Error("QuickBooks did not return the created item");
  logger.info({ name }, "Created QuickBooks service item");
  return { value: created.Item.Id, name: created.Item.Name };
}

export type QboInvoicePayload = {
  CustomerRef: Ref;
  TxnDate: string;
  Line: Array<Record<string, unknown>>;
  PrivateNote?: string;
};

/**
 * Pure mapping from our invoice lines to a QBO Invoice create body. The
 * caller supplies the item ref per productService name (resolved via
 * findOrCreateItem). Line order, descriptions, quantities, rates, amounts,
 * and service dates mirror the report/CSV/PDF exactly. Lines with no rate on
 * file go over at $0 with the warning kept in the description, same as the CSV.
 */
export function buildQboInvoicePayload(opts: {
  customerRef: Ref;
  lines: InvoiceLine[];
  itemRefsByName: Map<string, Ref>;
  txnDate: string; // YYYY-MM-DD
  periodStart: string;
  periodEnd: string;
}): QboInvoicePayload {
  const Line = opts.lines.map((line, i) => {
    const itemRef = opts.itemRefsByName.get(line.productService);
    if (!itemRef) {
      throw new Error(`Missing QuickBooks item mapping for "${line.productService}"`);
    }
    return {
      LineNum: i + 1,
      DetailType: "SalesItemLineDetail",
      Amount: line.amount,
      Description: line.missingRate ? `${line.description} — NO RATE ON FILE` : line.description,
      SalesItemLineDetail: {
        ItemRef: itemRef,
        Qty: line.qty,
        UnitPrice: line.rate ?? 0,
        ServiceDate: line.date,
      },
    };
  });
  return {
    CustomerRef: opts.customerRef,
    TxnDate: opts.txnDate,
    Line,
    PrivateNote: `Hodge Staffing time app — billing period ${opts.periodStart} to ${opts.periodEnd}`,
  };
}

export type QboCreatedInvoice = { id: string; docNumber: string | null };

/** Create the invoice in QBO — a single API call, so it's all-or-nothing. */
export async function createQboInvoice(
  access: Access,
  payload: QboInvoicePayload,
): Promise<QboCreatedInvoice> {
  const created = (await qboFetch(access, "/invoice", {
    method: "POST",
    body: JSON.stringify(payload),
  })) as { Invoice?: { Id: string; DocNumber?: string } };
  if (!created.Invoice) throw new Error("QuickBooks did not return the created invoice");
  return { id: created.Invoice.Id, docNumber: created.Invoice.DocNumber ?? null };
}
