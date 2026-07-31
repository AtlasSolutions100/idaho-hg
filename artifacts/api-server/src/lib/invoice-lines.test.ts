import { describe, it, expect } from "vitest";
import {
  buildInvoiceLines,
  dateRangeLabel,
  shortDate,
  type InvoiceEntryInput,
} from "./invoice-lines";

const base = {
  employeeId: "e1",
  employeeName: "Jane Smith",
  employeeRole: "PT",
  visitType: null as string | null,
  hours: null as number | null,
  mileage: null as number | null,
  perDiem: null as number | null,
};

function entry(overrides: Partial<InvoiceEntryInput> & { id: number; date: string }): InvoiceEntryInput {
  return { ...base, ...overrides };
}

describe("date formatting", () => {
  it("formats short dates and ranges like the real invoices", () => {
    expect(shortDate("2026-07-12")).toBe("7/12/26");
    expect(dateRangeLabel("2026-07-12", "2026-07-25")).toBe("7/12-7/25/26");
    expect(dateRangeLabel("2026-07-14", "2026-07-14")).toBe("7/14/26");
  });
});

describe("buildInvoiceLines", () => {
  it("aggregates visits by employee + visit type with qty and range", () => {
    const { lines, total } = buildInvoiceLines([
      entry({ id: 1, date: "2026-07-12", visitType: "skilled-nursing", visitRate: 120 }),
      entry({ id: 2, date: "2026-07-20", visitType: "skilled-nursing", visitRate: 120 }),
      entry({ id: 3, date: "2026-07-25", visitType: "skilled-nursing", visitRate: 120 }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      productService: "Jane Smith PT",
      description: "SNV 7/12-7/25/26",
      qty: 3,
      rate: 120,
      amount: 360,
      kind: "visit",
      missingRate: false,
      date: "2026-07-25",
    });
    expect(total).toBe(360);
  });

  it("splits a line when the rate changed mid-range, in chronological order", () => {
    const { lines, total } = buildInvoiceLines([
      entry({ id: 1, date: "2026-07-02", visitType: "skilled-nursing", visitRate: 120 }),
      entry({ id: 2, date: "2026-07-20", visitType: "skilled-nursing", visitRate: 130 }),
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ rate: 120, qty: 1, description: "SNV 7/2/26" });
    expect(lines[1]).toMatchObject({ rate: 130, qty: 1, description: "SNV 7/20/26" });
    expect(total).toBe(250);
  });

  it("aggregates hourly entries into one line of summed hours", () => {
    const { lines, total } = buildInvoiceLines([
      entry({ id: 1, date: "2026-07-06", hours: 4, hourlyRate: 82 }),
      entry({ id: 2, date: "2026-07-08", hours: 3.5, hourlyRate: 82 }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      description: "Hourly 7/6-7/8/26",
      qty: 7.5,
      rate: 82,
      amount: 615,
      kind: "hourly",
    });
    expect(total).toBe(615);
  });

  it("gives mileage and per diem their own lines", () => {
    const { lines, total } = buildInvoiceLines([
      entry({
        id: 1,
        date: "2026-07-12",
        visitType: "physical-therapy",
        visitRate: 110,
        mileage: 30,
        mileageRate: 0.655,
        perDiem: 1,
        perDiemRate: 45,
      }),
      entry({ id: 2, date: "2026-07-13", mileage: 20, mileageRate: 0.655 }),
    ]);
    const kinds = lines.map((l) => l.kind);
    expect(kinds).toEqual(["visit", "mileage", "per-diem"]);
    const mileage = lines[1];
    expect(mileage).toMatchObject({
      description: "Mileage 7/12-7/13/26",
      qty: 50,
      rate: 0.655,
      amount: 32.75,
    });
    expect(lines[2]).toMatchObject({ description: "Per diem 7/12/26", qty: 1, amount: 45 });
    expect(total).toBe(110 + 32.75 + 45);
  });

  it("orders by employee name, then visits, hourly, mileage, per diem", () => {
    const { lines } = buildInvoiceLines([
      entry({ id: 1, date: "2026-07-10", employeeId: "e2", employeeName: "Zoe Adams", employeeRole: "RN", visitType: "skilled-nursing", visitRate: 120 }),
      entry({ id: 2, date: "2026-07-10", hours: 2, hourlyRate: 82, mileage: 10, mileageRate: 0.655 }),
      entry({ id: 3, date: "2026-07-11", visitType: "speech-therapy", visitRate: 100 }),
    ]);
    expect(lines.map((l) => [l.productService, l.kind])).toEqual([
      ["Jane Smith PT", "visit"],
      ["Jane Smith PT", "hourly"],
      ["Jane Smith PT", "mileage"],
      ["Zoe Adams RN", "visit"],
    ]);
  });

  it("flags missing rates as $0 lines instead of dropping them", () => {
    const { lines, total, missingRateCount } = buildInvoiceLines([
      entry({ id: 1, date: "2026-07-12", visitType: "skilled-nursing" }),
      entry({ id: 2, date: "2026-07-13", hours: 3 }),
    ]);
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.missingRate && l.amount === 0)).toBe(true);
    expect(lines[0].note).toMatch(/No billing rate/);
    expect(lines[1].note).toMatch(/hourly billing rate/i);
    expect(missingRateCount).toBe(2);
    expect(total).toBe(0);
  });

  it("keeps missing-rate visits separate from rated visits of the same type", () => {
    const { lines } = buildInvoiceLines([
      entry({ id: 1, date: "2026-07-12", visitType: "skilled-nursing", visitRate: 120 }),
      entry({ id: 2, date: "2026-07-13", visitType: "skilled-nursing" }),
    ]);
    expect(lines).toHaveLength(2);
    expect(lines.filter((l) => l.missingRate)).toHaveLength(1);
  });

  it("counts entries with nothing billable as unbilled", () => {
    const { lines, unbilledCount } = buildInvoiceLines([
      entry({ id: 1, date: "2026-07-12" }),
      entry({ id: 2, date: "2026-07-13", hours: 0 }),
    ]);
    expect(lines).toHaveLength(0);
    expect(unbilledCount).toBe(2);
  });

  it("splits A -> B -> A rate sequences into three separate segments", () => {
    const { lines, total } = buildInvoiceLines([
      entry({ id: 1, date: "2026-07-01", visitType: "skilled-nursing", visitRate: 120 }),
      entry({ id: 2, date: "2026-07-10", visitType: "skilled-nursing", visitRate: 130 }),
      entry({ id: 3, date: "2026-07-20", visitType: "skilled-nursing", visitRate: 120 }),
    ]);
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => [l.rate, l.description])).toEqual([
      [120, "SNV 7/1/26"],
      [130, "SNV 7/10/26"],
      [120, "SNV 7/20/26"],
    ]);
    expect(total).toBe(370);
  });

  it("segments correctly even when entries arrive out of date order", () => {
    const { lines } = buildInvoiceLines([
      entry({ id: 2, date: "2026-07-10", visitType: "skilled-nursing", visitRate: 130 }),
      entry({ id: 1, date: "2026-07-01", visitType: "skilled-nursing", visitRate: 120 }),
      entry({ id: 3, date: "2026-07-12", visitType: "skilled-nursing", visitRate: 130 }),
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ rate: 120, qty: 1 });
    expect(lines[1]).toMatchObject({ rate: 130, qty: 2, description: "SNV 7/10-7/12/26" });
  });

  it("rounds totals to cents across many fractional lines", () => {
    const { lines, total } = buildInvoiceLines([
      entry({ id: 1, date: "2026-07-01", mileage: 10.1, mileageRate: 0.655 }),
      entry({ id: 2, date: "2026-07-02", mileage: 10.2, mileageRate: 0.655 }),
    ]);
    expect(lines[0].qty).toBe(20.3);
    expect(lines[0].amount).toBe(13.3);
    expect(total).toBe(13.3);
  });
});
