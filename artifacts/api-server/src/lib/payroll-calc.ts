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
  hours: number | null;
  mileage: number | null;
  perDiem: number | null;
  isWeekend: boolean;
  isHoliday: boolean;
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
export function computePayrollAmounts(
  entry: PayrollEntryInput,
  rate: PayrollRate | undefined,
): PayrollAmounts {
  if (!rate) {
    return { multiplier: 1, basePay: 0, mileagePay: 0, perDiemPay: 0, total: 0, missingRate: true };
  }
  const multiplier = resolveMultiplier(entry, rate);
  let basePay = 0;
  if (entry.visitType) {
    basePay = rate.visitRate * multiplier;
  } else if (entry.hours != null) {
    basePay = entry.hours * rate.hourlyRate * multiplier;
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
  entry: Pick<PayrollEntryInput, "visitType">,
  rate: { rate: number } | undefined,
): InvoiceAmount {
  if (!entry.visitType) {
    return { amount: 0, billable: false, missingRate: false };
  }
  if (!rate) {
    return { amount: 0, billable: true, missingRate: true };
  }
  return { amount: round2(rate.rate), billable: true, missingRate: false };
}
