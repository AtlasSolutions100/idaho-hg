// Pure payroll/invoice math, extracted so it can be unit tested without a
// database. The report routes resolve rates (see rate-lookup.ts) and feed
// them through these functions.

export const round2 = (n: number): number => Math.round(n * 100) / 100;

export type PayrollRate = {
  hourlyRate: number;
  visitRate: number;
  mileageRate: number;
  perDiemRate: number;
  weekendMultiplier: number;
  holidayMultiplier: number;
};

export type PayrollEntryInput = {
  visitType: string | null;
  /**
   * How many of the visit type this entry covers — 2 for two evals on the
   * same day, or the number of billable blocks for a type billed in
   * increments. Absent/undefined means 1, so entries written before the
   * column existed pay exactly what they always did.
   */
  quantity?: number | null;
  hours: number | null;
  mileage: number | null;
  perDiem: number | null;
  isWeekend: boolean;
  isHoliday: boolean;
  /** "Other" one-off — paid the flat customPayAmount instead of any rate. */
  isOther?: boolean;
  /** Admin-set flat pay for an Other entry; null/undefined = not priced yet. */
  customPayAmount?: number | null;
};

export type PayrollAmounts = {
  multiplier: number;
  basePay: number;
  mileagePay: number;
  perDiemPay: number;
  total: number;
  missingRate: boolean;
};

/**
 * Weekend/holiday rule: if an entry is flagged as both weekend AND holiday,
 * only the HIGHER of the two multipliers applies (they do not stack).
 * Normal entries use multiplier 1.
 */
/**
 * How many units an entry covers, defaulting to 1. Entries created before
 * quantity existed carry no value and must keep pricing at exactly one unit.
 */
export function quantityOf(entry: Pick<PayrollEntryInput, "quantity">): number {
  const q = entry.quantity;
  return q != null && q > 0 ? q : 1;
}

export function resolveMultiplier(
  entry: Pick<PayrollEntryInput, "isWeekend" | "isHoliday">,
  rate: PayrollRate,
): number {
  if (entry.isWeekend && entry.isHoliday) {
    return Math.max(rate.weekendMultiplier, rate.holidayMultiplier);
  }
  if (entry.isWeekend) return rate.weekendMultiplier;
  if (entry.isHoliday) return rate.holidayMultiplier;
  return 1;
}

/**
 * Compute pay amounts for one time entry. A missing rate produces zero
 * amounts but is flagged (`missingRate: true`) — entries are never silently
 * skipped. Visit entries pay a flat per-visit rate; hourly entries pay
 * hours * hourlyRate; both are subject to the weekend/holiday multiplier.
 * Mileage and per diem reimbursements are NOT multiplied.
 */
/** Resolved, per-entry pay inputs the report route computes (see rate-lookup). */
export type PayrollComputeOptions = {
  /** Per-visit-type pay (visit_pay_rates) for a visit entry; else rate.visitRate. */
  visitPayRate?: number;
  /** Per-client hourly pay (client_pay_rates) for an hourly entry; else rate.hourlyRate. */
  hourlyPayRate?: number;
  /** Pre-resolved weekend/holiday multiplier (per-client); else the employee rate's. */
  multiplier?: number;
};

export function computePayrollAmounts(
  entry: PayrollEntryInput,
  rate: PayrollRate | undefined,
  opts: PayrollComputeOptions = {},
): PayrollAmounts {
  // "Other" one-offs pay Molly's flat custom amount — no rate table, no
  // weekend/holiday multiplier. An unpriced Other entry is flagged
  // (missingRate) rather than silently paid $0. Mileage still reimburses at
  // the employee's mileage rate when one exists.
  if (entry.isOther) {
    const priced = entry.customPayAmount != null;
    const basePay = priced ? entry.customPayAmount! : 0;
    const needsMileageRate = entry.mileage != null && entry.mileage > 0;
    const mileagePay = needsMileageRate && rate ? entry.mileage! * rate.mileageRate : 0;
    return {
      multiplier: 1,
      basePay,
      mileagePay,
      perDiemPay: 0,
      total: round2(basePay + mileagePay),
      missingRate: !priced || (needsMileageRate && !rate),
    };
  }
  if (!rate) {
    return { multiplier: 1, basePay: 0, mileagePay: 0, perDiemPay: 0, total: 0, missingRate: true };
  }
  // Per-client weekend/holiday multiplier when resolved (see rate-lookup);
  // otherwise the employee rate's multiplier (backwards-compatible).
  const multiplier = opts.multiplier ?? resolveMultiplier(entry, rate);
  let basePay = 0;
  if (entry.visitType) {
    // Per-visit-type pay (visit_pay_rates) when set; otherwise fall back to the
    // employee's flat visitRate so existing behavior is preserved until Molly
    // fills in the discipline × visit-type pay matrix.
    //
    // The rate is per visit — or, for a type billed in increments, per block —
    // so it is multiplied by how many the entry covers.
    const perVisitPay = opts.visitPayRate ?? rate.visitRate;
    basePay = perVisitPay * quantityOf(entry) * multiplier;
  } else if (entry.hours != null) {
    // Per-client hourly pay (client_pay_rates) when set; else the employee's
    // flat hourlyRate.
    const hourlyPay = opts.hourlyPayRate ?? rate.hourlyRate;
    basePay = entry.hours * hourlyPay * multiplier;
  }
  const mileagePay = entry.mileage != null ? entry.mileage * rate.mileageRate : 0;
  const perDiemPay = entry.perDiem != null ? entry.perDiem * rate.perDiemRate : 0;
  const total = round2(basePay + mileagePay + perDiemPay);
  return { multiplier, basePay, mileagePay, perDiemPay, total, missingRate: false };
}

export type InvoiceAmount = {
  amount: number;
  billable: boolean;
  missingRate: boolean;
};

/**
 * Compute the billed amount for one invoice line. Client rates exist per
 * visit type only: visit entries bill the client's rate for that visit type,
 * hourly-only entries (no visit type) are listed but unbilled. Missing rates
 * bill 0 but are flagged.
 */
export function computeInvoiceAmount(
  entry: Pick<PayrollEntryInput, "visitType" | "quantity">,
  rate: { rate: number } | undefined,
): InvoiceAmount {
  if (!entry.visitType) {
    return { amount: 0, billable: false, missingRate: false };
  }
  if (!rate) {
    return { amount: 0, billable: true, missingRate: true };
  }
  return { amount: round2(rate.rate * quantityOf(entry)), billable: true, missingRate: false };
}
