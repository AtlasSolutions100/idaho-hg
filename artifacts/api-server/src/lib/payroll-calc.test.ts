import { describe, expect, it } from "vitest";
import {
  computeInvoiceAmount,
  computePayrollAmounts,
  resolveMultiplier,
  round2,
  type PayrollEntryInput,
  type PayrollRate,
} from "./payroll-calc";

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
