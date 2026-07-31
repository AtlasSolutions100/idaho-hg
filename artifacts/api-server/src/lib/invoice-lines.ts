// Pure QuickBooks-style invoice line builder, extracted so it can be unit
// tested without a database. The invoice route resolves rates per entry
// (see rate-lookup.ts) and feeds annotated entries through buildInvoiceLines.
//
// Output mirrors Molly's real QuickBooks invoices:
//   Date | Product or service | Description | Qty | Rate | Amount
// - Product/Service = "Employee Name Discipline" (e.g. "Jane Smith PT")
// - Description = visit abbreviation + date range (e.g. "SNV 7/12-7/25/26"),
//   or "Hourly ...", "Mileage ...", "Per diem ..."
// - One aggregated line per employee + type; if the rate changed mid-range
//   the line splits per rate so amounts stay honest.

import { round2 } from "./payroll-calc";

export type InvoiceEntryInput = {
  id: number | string;
  date: string; // YYYY-MM-DD
  employeeId: string;
  employeeName: string;
  employeeRole: string;
  visitType: string | null;
  hours: number | null;
  mileage: number | null;
  perDiem: number | null;
  /** Client's per-visit rate effective on the entry date (visit entries). */
  visitRate?: number;
  /** Client's hourly billing rate effective on the entry date (hourly entries). */
  hourlyRate?: number;
  /** Employee mileage reimbursement rate on the entry date (passed through to the client). */
  mileageRate?: number;
  /** Employee per-diem rate on the entry date (passed through to the client). */
  perDiemRate?: number;
};

export type InvoiceLineKind = "visit" | "hourly" | "mileage" | "per-diem";

export type InvoiceLine = {
  lineId: string;
  date: string; // ISO date of the last entry in the line (QuickBooks service date)
  productService: string;
  description: string;
  qty: number;
  rate?: number;
  amount: number;
  kind: InvoiceLineKind;
  missingRate: boolean;
  note?: string;
};

export const visitAbbreviations: Record<string, string> = {
  "skilled-nursing": "SNV",
  "physical-therapy": "PT visit",
  "occupational-therapy": "OT visit",
  "speech-therapy": "ST visit",
};

/** "2026-07-12" -> "7/12/26" */
export function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

/** Date range like Molly's invoices: "7/12-7/25/26", or a single date "7/14/26". */
export function dateRangeLabel(first: string, last: string): string {
  if (first === last) return shortDate(first);
  const [, m1, d1] = first.split("-");
  return `${Number(m1)}/${Number(d1)}-${shortDate(last)}`;
}

type Bucket = {
  kind: InvoiceLineKind;
  employeeName: string;
  employeeRole: string;
  visitType: string | null;
  rate: number | undefined;
  qty: number;
  firstDate: string;
  lastDate: string;
  order: number; // insertion order within its group, keeps date order stable
};

const KIND_ORDER: Record<InvoiceLineKind, number> = {
  visit: 0,
  hourly: 1,
  mileage: 2,
  "per-diem": 3,
};

const MISSING_NOTES: Record<InvoiceLineKind, string> = {
  visit: "No billing rate on file for this visit type/date",
  hourly: "No hourly billing rate on file — add one on the Client Rates page",
  mileage: "No mileage rate on file for this employee/date",
  "per-diem": "No per-diem rate on file for this employee/date",
};

export type InvoiceLinesResult = {
  lines: InvoiceLine[];
  total: number;
  missingRateCount: number;
  unbilledCount: number;
};

export function buildInvoiceLines(entries: InvoiceEntryInput[]): InvoiceLinesResult {
  // Segments per employee+kind+visitType: a new segment starts whenever the
  // rate in effect changes, so an A→B→A rate sequence yields three lines and
  // each line's date range only covers dates actually billed at that rate.
  // Entries are processed in date order (the route queries them sorted).
  const segments = new Map<string, Bucket[]>();
  let order = 0;
  let unbilledCount = 0;

  const add = (
    entry: InvoiceEntryInput,
    kind: InvoiceLineKind,
    visitType: string | null,
    rate: number | undefined,
    qty: number,
  ) => {
    const key = [entry.employeeId, kind, visitType ?? ""].join("|");
    let list = segments.get(key);
    if (!list) {
      list = [];
      segments.set(key, list);
    }
    let bucket = list[list.length - 1];
    if (!bucket || bucket.rate !== rate) {
      bucket = {
        kind,
        employeeName: entry.employeeName,
        employeeRole: entry.employeeRole,
        visitType,
        rate,
        qty: 0,
        firstDate: entry.date,
        lastDate: entry.date,
        order: order++,
      };
      list.push(bucket);
    }
    bucket.qty = round2(bucket.qty + qty);
    if (entry.date < bucket.firstDate) bucket.firstDate = entry.date;
    if (entry.date > bucket.lastDate) bucket.lastDate = entry.date;
  };

  const sortedEntries = [...entries].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
  for (const entry of sortedEntries) {
    let billedSomething = false;
    if (entry.visitType) {
      add(entry, "visit", entry.visitType, entry.visitRate, 1);
      billedSomething = true;
    } else if (entry.hours != null && entry.hours > 0) {
      add(entry, "hourly", null, entry.hourlyRate, entry.hours);
      billedSomething = true;
    }
    if (entry.mileage != null && entry.mileage > 0) {
      add(entry, "mileage", null, entry.mileageRate, entry.mileage);
      billedSomething = true;
    }
    if (entry.perDiem != null && entry.perDiem > 0) {
      add(entry, "per-diem", null, entry.perDiemRate, entry.perDiem);
      billedSomething = true;
    }
    if (!billedSomething) unbilledCount += 1;
  }

  const sorted = [...segments.values()].flat().sort((a, b) => {
    const byName = a.employeeName.localeCompare(b.employeeName);
    if (byName !== 0) return byName;
    const byKind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (byKind !== 0) return byKind;
    if (a.visitType !== b.visitType) return (a.visitType ?? "").localeCompare(b.visitType ?? "");
    // Same employee/kind/visit type but different rate (mid-range rate change):
    // keep chronological order.
    if (a.firstDate !== b.firstDate) return a.firstDate < b.firstDate ? -1 : 1;
    return a.order - b.order;
  });

  let total = 0;
  let missingRateCount = 0;
  const lines: InvoiceLine[] = sorted.map((b, i) => {
    const range = dateRangeLabel(b.firstDate, b.lastDate);
    const missingRate = b.rate == null;
    if (missingRate) missingRateCount += 1;
    const amount = b.rate != null ? round2(b.qty * b.rate) : 0;
    total = round2(total + amount);
    let description: string;
    switch (b.kind) {
      case "visit":
        description = `${visitAbbreviations[b.visitType ?? ""] ?? b.visitType} ${range}`;
        break;
      case "hourly":
        description = `Hourly ${range}`;
        break;
      case "mileage":
        description = `Mileage ${range}`;
        break;
      case "per-diem":
        description = `Per diem ${range}`;
        break;
    }
    return {
      lineId: String(i + 1),
      date: b.lastDate,
      productService: `${b.employeeName} ${b.employeeRole}`,
      description,
      qty: b.qty,
      ...(b.rate != null ? { rate: b.rate } : {}),
      amount,
      kind: b.kind,
      missingRate,
      ...(missingRate ? { note: MISSING_NOTES[b.kind] } : {}),
    };
  });

  return { lines, total, missingRateCount, unbilledCount };
}
