import { describe, expect, it } from "vitest";
import { pickForDate } from "./rate-lookup";

// Rate history rows as they exist in employee_rates / client_rates: append-only
// rows with an effectiveDate; the resolver picks the rate in effect on a date.
const row = (id: number, effectiveDate: string, rate: number) => ({ id, effectiveDate, rate });

describe("pickForDate (rate effective-date resolution)", () => {
  const history = [row(1, "2026-01-01", 20), row(2, "2026-07-15", 25)];

  it("uses the old rate for entries before a mid-period rate change", () => {
    expect(pickForDate(history, "2026-07-10")?.rate).toBe(20);
    expect(pickForDate(history, "2026-07-14")?.rate).toBe(20);
  });

  it("uses the new rate starting on the effective date", () => {
    expect(pickForDate(history, "2026-07-15")?.rate).toBe(25);
    expect(pickForDate(history, "2026-07-31")?.rate).toBe(25);
  });

  it("is order-independent (rows may come back in any order)", () => {
    const reversed = [...history].reverse();
    expect(pickForDate(reversed, "2026-07-10")?.rate).toBe(20);
    expect(pickForDate(reversed, "2026-07-20")?.rate).toBe(25);
  });

  it("picks the latest applicable row among several past changes", () => {
    const many = [row(1, "2025-01-01", 18), row(2, "2026-01-01", 20), row(3, "2026-07-15", 25)];
    expect(pickForDate(many, "2026-06-01")?.rate).toBe(20);
  });

  it("breaks effective-date ties by highest id (most recently added wins)", () => {
    const tied = [row(1, "2026-01-01", 20), row(2, "2026-01-01", 22)];
    expect(pickForDate(tied, "2026-02-01")?.rate).toBe(22);
  });

  it("falls back to the earliest known rate when all rows postdate the entry", () => {
    expect(pickForDate(history, "2025-12-01")?.rate).toBe(20);
  });

  it("returns undefined when there is no rate history at all", () => {
    expect(pickForDate([], "2026-07-01")).toBeUndefined();
  });
});
