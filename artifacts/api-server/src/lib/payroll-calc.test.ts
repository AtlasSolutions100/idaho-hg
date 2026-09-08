import { describe, expect, it } from "vitest";
import {
  billableUnits,
  computeInvoiceAmount,
  computePayrollAmounts,
  resolveMultiplier,
  round2,
  type PayrollEntryInput,
  type PayrollRate,
  type VisitTypeUnit,
} from "./payroll-calc";

/** Hospital at Home / drive time: hourly rate, logged to the quarter hour. */
const hourly: VisitTypeUnit = { billingUnit: "increment", incrementMinutes: 15 };
const perVisit: VisitTypeUnit = { billingUnit: "visit", incrementMinutes: 15 };

const rate: PayrollRate = {
  hourlyRate: 20,
  visitRate: 50,
  mileageRate: 0.65,
  perDiemRate: 30,
  weekendMultiplier: 1.5,
  holidayMultiplier: 2,
};

const entry = (overrides: Partial<PayrollEntryInput> = {}): PayrollEntryInput => ({
  visitType: null,
  hours: null,
  mileage: null,
  perDiem: null,
  isWeekend: false,
  isHoliday: false,
  ...overrides,
});

describe("resolveMultiplier", () => {
  it("uses 1 for a normal weekday entry", () => {
    expect(resolveMultiplier(entry(), rate)).toBe(1);
  });

  it("uses the weekend multiplier on weekends", () => {
    expect(resolveMultiplier(entry({ isWeekend: true }), rate)).toBe(1.5);
  });

  it("uses the holiday multiplier on holidays", () => {
    expect(resolveMultiplier(entry({ isHoliday: true }), rate)).toBe(2);
  });

  it("uses the HIGHER of the two (not stacked) when both flags are set", () => {
    expect(resolveMultiplier(entry({ isWeekend: true, isHoliday: true }), rate)).toBe(2);
    // Symmetric: weekend higher than holiday
    const flipped = { ...rate, weekendMultiplier: 2.5, holidayMultiplier: 1.25 };
    expect(resolveMultiplier(entry({ isWeekend: true, isHoliday: true }), flipped)).toBe(2.5);
    // Never stacks: 1.5 * 2 = 3 must NOT be the answer
    expect(
      resolveMultiplier(entry({ isWeekend: true, isHoliday: true }), rate),
    ).not.toBe(rate.weekendMultiplier * rate.holidayMultiplier);
  });
});

describe("computePayrollAmounts", () => {
  it("pays a flat per-visit rate for visit entries", () => {
    const r = computePayrollAmounts(entry({ visitType: "SOC" }), rate);
    expect(r.basePay).toBe(50);
    expect(r.total).toBe(50);
    expect(r.missingRate).toBe(false);
  });

  it("uses the per-visit-type pay rate when provided (overrides the flat visitRate)", () => {
    // A St. Luke's start-of-care that pays $268 for this discipline.
    const r = computePayrollAmounts(entry({ visitType: "soc" }), rate, { visitPayRate: 268 });
    expect(r.basePay).toBe(268);
    expect(r.total).toBe(268);
    expect(r.missingRate).toBe(false);
  });

  it("falls back to the flat visitRate when no per-visit-type rate is given", () => {
    const r = computePayrollAmounts(entry({ visitType: "soc" }), rate, {});
    expect(r.basePay).toBe(50);
  });

  it("applies the weekend multiplier to the per-visit-type pay rate", () => {
    const r = computePayrollAmounts(entry({ visitType: "soc", isWeekend: true }), rate, {
      visitPayRate: 100,
    });
    expect(r.basePay).toBe(150); // 100 * 1.5, multiplier still applies
  });

  it("uses a per-client hourly pay rate when provided (overrides flat hourlyRate)", () => {
    const r = computePayrollAmounts(entry({ hours: 2 }), rate, { hourlyPayRate: 71 });
    expect(r.basePay).toBe(142); // 2h * $71 (client pay), not 2*20
  });

  it("uses a pre-resolved per-client multiplier when provided", () => {
    // St. Luke's +10% weekend: 100 * 1.1 = 110, not the employee's 1.5x.
    const r = computePayrollAmounts(entry({ visitType: "soc", isWeekend: true }), rate, {
      visitPayRate: 100,
      multiplier: 1.1,
    });
    expect(r.basePay).toBeCloseTo(110, 5);
  });

  it("pays hours * hourlyRate for hourly entries", () => {
    const r = computePayrollAmounts(entry({ hours: 3.5 }), rate);
    expect(r.basePay).toBe(70);
    expect(r.total).toBe(70);
  });

  it("visit entries ignore hours even if present (visit rate wins)", () => {
    const r = computePayrollAmounts(entry({ visitType: "SOC", hours: 2 }), rate);
    expect(r.basePay).toBe(50);
  });

  it("applies the multiplier to base pay: weekend visit", () => {
    const r = computePayrollAmounts(entry({ visitType: "SOC", isWeekend: true }), rate);
    expect(r.multiplier).toBe(1.5);
    expect(r.basePay).toBe(75);
  });

  it("applies the multiplier to hourly pay: holiday hours", () => {
    const r = computePayrollAmounts(entry({ hours: 4, isHoliday: true }), rate);
    expect(r.multiplier).toBe(2);
    expect(r.basePay).toBe(160);
  });

  it("both flags: higher-of-the-two applied once", () => {
    const r = computePayrollAmounts(
      entry({ visitType: "SOC", isWeekend: true, isHoliday: true }),
      rate,
    );
    expect(r.multiplier).toBe(2);
    expect(r.basePay).toBe(100); // 50 * 2, not 50 * 3
  });

  it("does NOT multiply mileage or per diem on weekends/holidays", () => {
    const r = computePayrollAmounts(
      entry({ visitType: "SOC", mileage: 10, perDiem: 1, isHoliday: true }),
      rate,
    );
    expect(r.mileagePay).toBe(6.5); // 10 * 0.65, no multiplier
    expect(r.perDiemPay).toBe(30); // 1 * 30, no multiplier
    expect(r.total).toBe(round2(50 * 2 + 6.5 + 30));
  });

  it("adds mileage and per diem to hourly entries too", () => {
    const r = computePayrollAmounts(entry({ hours: 2, mileage: 12, perDiem: 2 }), rate);
    expect(r.total).toBe(round2(40 + 12 * 0.65 + 60));
  });

  it("flags missing rate with zero amounts instead of skipping", () => {
    const r = computePayrollAmounts(entry({ visitType: "SOC", hours: 5, mileage: 10 }), undefined);
    expect(r.missingRate).toBe(true);
    expect(r.basePay).toBe(0);
    expect(r.mileagePay).toBe(0);
    expect(r.perDiemPay).toBe(0);
    expect(r.total).toBe(0);
  });

  it("rounds totals to cents", () => {
    const oddRate = { ...rate, hourlyRate: 19.99 };
    const r = computePayrollAmounts(entry({ hours: 1.33 }), oddRate);
    expect(r.total).toBe(round2(1.33 * 19.99));
    expect(Number.isInteger(r.total * 100 + 1e-9) || Math.abs(r.total * 100 - Math.round(r.total * 100)) < 1e-6).toBe(true);
  });
});

describe("computeInvoiceAmount", () => {
  it("bills visit entries at the client rate", () => {
    const r = computeInvoiceAmount({ visitType: "SOC" }, { rate: 120 });
    expect(r).toEqual({ amount: 120, billable: true, missingRate: false });
  });

  it("flags missing client rate but keeps the line billable", () => {
    const r = computeInvoiceAmount({ visitType: "Recert" }, undefined);
    expect(r).toEqual({ amount: 0, billable: true, missingRate: true });
  });

  it("lists hourly entries as unbilled (no client rate concept)", () => {
    const r = computeInvoiceAmount({ visitType: null }, undefined);
    expect(r).toEqual({ amount: 0, billable: false, missingRate: false });
  });
});

// The numbers here are Molly's, off the St. Luke's reconciliation and payroll
// sheets. They are the whole reason billableUnits exists: her Hospital-at-Home
// column holds hours (1.5, 0.5, 2) against an $84 rate, but the app stores the
// same time as 15-minute blocks. Multiplying the hourly rate by the block
// count bills four times what she invoices.
describe("billableUnits", () => {
  it("counts a per-visit type as its plain quantity", () => {
    expect(billableUnits({ quantity: 2 }, perVisit)).toBe(2);
  });

  it("turns 15-minute blocks into hours for an hourly type", () => {
    expect(billableUnits({ quantity: 6 }, hourly)).toBe(1.5);
    expect(billableUnits({ quantity: 2 }, hourly)).toBe(0.5);
    expect(billableUnits({ quantity: 1 }, hourly)).toBe(0.25);
  });

  it("defaults a missing quantity to one unit", () => {
    expect(billableUnits({ quantity: null }, perVisit)).toBe(1);
    expect(billableUnits({ quantity: undefined }, hourly)).toBe(0.25);
  });

  it("prices per visit when the type is no longer in the catalog", () => {
    expect(billableUnits({ quantity: 6 }, undefined)).toBe(6);
  });

  it("honors a non-15 step", () => {
    expect(billableUnits({ quantity: 3 }, { billingUnit: "increment", incrementMinutes: 30 })).toBe(1.5);
  });
});

describe("hourly visit types (Hospital at Home, drive time)", () => {
  it("pays 1.5 hours of Hospital at Home at Molly's $67.20/hr, not per block", () => {
    const r = computePayrollAmounts(
      entry({ visitType: "hospital-at-home", quantity: 6 }),
      rate,
      { visitPayRate: 67.2, unit: hourly },
    );
    expect(r.basePay).toBeCloseTo(100.8, 2);
  });

  it("bills the same 1.5 hours at $84/hr — the $126 on her sheet", () => {
    const r = computeInvoiceAmount(
      { visitType: "hospital-at-home", quantity: 6 },
      { rate: 84 },
      hourly,
    );
    expect(r.amount).toBe(126);
  });

  it("would have billed 4x without the unit — the bug this guards", () => {
    const withoutUnit = computeInvoiceAmount(
      { visitType: "hospital-at-home", quantity: 6 },
      { rate: 84 },
      perVisit,
    );
    expect(withoutUnit.amount).toBe(504);
  });

  it("pays a half hour of drive time at half the non-visit rate", () => {
    // Her RN payroll sheet rates HAH/HOS drive at $33.60/hr.
    const r = computePayrollAmounts(
      entry({ visitType: "drive-time", quantity: 2 }),
      rate,
      { visitPayRate: 33.6, unit: hourly },
    );
    expect(r.basePay).toBeCloseTo(16.8, 2);
  });

  it("still applies the weekend/holiday multiplier to an hourly type", () => {
    const r = computePayrollAmounts(
      entry({ visitType: "hospital-at-home", quantity: 4, isWeekend: true }),
      rate,
      { visitPayRate: 67.2, unit: hourly, multiplier: 1.1 },
    );
    // 1 hour x $67.20 x 1.1 (St. Luke's +10%)
    expect(r.basePay).toBeCloseTo(73.92, 2);
  });

  it("leaves per-visit types untouched", () => {
    const r = computePayrollAmounts(
      entry({ visitType: "soc", quantity: 2 }),
      rate,
      { visitPayRate: 268.8, unit: perVisit },
    );
    expect(r.basePay).toBeCloseTo(537.6, 2);
  });
});
