// On-call and call-back hours.
//
// Molly, 11 Sep 2026, on Idaho Youth Ranch: "On call is by the hour... minimum
// hours is 4 for this contract. Call back rate is same as the hourly rate
// ($93/hr)." Those are hourly clients — they log time in and out and never
// touch visit types — so the kind of hours an entry covers rides on the entry
// itself rather than being a visit type the client would reject.
//
// Billing and payroll both resolve rates through here so the invoice and the
// payroll run cannot disagree about what an on-call hour is worth.

export type HourKind = "regular" | "on-call" | "call-back";

export const HOUR_KINDS: HourKind[] = ["regular", "on-call", "call-back"];

/** How each kind reads on an invoice line, in Molly's words. */
export const HOUR_KIND_LABELS: Record<HourKind, string> = {
  regular: "hourly",
  "on-call": "on call",
  "call-back": "call back",
};

/** Anything unrecognised — including the null on every pre-existing row. */
export function normalizeHourKind(raw: string | null | undefined): HourKind {
  return raw === "on-call" || raw === "call-back" ? raw : "regular";
}

/**
 * Rate keys to try, most specific first. These are the same shape as the
 * existing hourly keys ("hourly-RN" then "hourly"), so on-call and call-back
 * get per-discipline rates, weekend/holiday variants and per-client pay for
 * free from resolveDayTypeRate.
 */
export function hourlyRateKeys(kind: HourKind, employeeRole: string): string[] {
  if (kind === "regular") return [`hourly-${employeeRole}`, "hourly"];
  return [`${kind}-${employeeRole}`, kind];
}

/**
 * Hours to charge and pay for. A call-back is worth the contract minimum even
 * when the nurse is back home in forty minutes — that is what the minimum is
 * for — so the hours that reach an invoice or a pay statement are these, not
 * the clock time.
 */
export function billableHours(
  hours: number,
  kind: HourKind,
  callBackMinimumHours: number | null | undefined,
): number {
  if (kind !== "call-back") return hours;
  const minimum = callBackMinimumHours ?? 0;
  return minimum > 0 ? Math.max(hours, minimum) : hours;
}
