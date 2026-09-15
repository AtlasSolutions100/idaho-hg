import { describe, it, expect } from "vitest";
import {
  hoursBetween,
  isHolidayDate,
  isValidDateString,
  isWeekendDate,
  payPeriodContaining,
} from "./work-calendar";

describe("isValidDateString", () => {
  it("accepts real dates and rejects impossible ones", () => {
    expect(isValidDateString("2026-08-07")).toBe(true);
    expect(isValidDateString("2028-02-29")).toBe(true); // leap year
    expect(isValidDateString("2026-02-30")).toBe(false);
    expect(isValidDateString("2026-13-01")).toBe(false);
    expect(isValidDateString("not-a-date")).toBe(false);
  });
});

describe("isWeekendDate", () => {
  it("flags Saturdays and Sundays", () => {
    expect(isWeekendDate("2026-08-08")).toBe(true); // Saturday
    expect(isWeekendDate("2026-08-09")).toBe(true); // Sunday
    expect(isWeekendDate("2026-08-07")).toBe(false); // Friday
    expect(isWeekendDate("2026-08-10")).toBe(false); // Monday
  });

  it("is false for malformed dates", () => {
    expect(isWeekendDate("not-a-date")).toBe(false);
  });
});

describe("isHolidayDate", () => {
  it("knows fixed-date holidays", () => {
    expect(isHolidayDate("2026-01-01")).toBe(true); // New Year's
    expect(isHolidayDate("2026-07-04")).toBe(true); // Independence Day
    expect(isHolidayDate("2026-12-25")).toBe(true); // Christmas
    expect(isHolidayDate("2026-12-24")).toBe(false);
  });

  it("computes floating holidays per year", () => {
    expect(isHolidayDate("2026-05-25")).toBe(true); // Memorial Day (last Mon of May 2026)
    expect(isHolidayDate("2026-09-07")).toBe(true); // Labor Day (1st Mon of Sep 2026)
    expect(isHolidayDate("2026-11-26")).toBe(true); // Thanksgiving (4th Thu of Nov 2026)
    expect(isHolidayDate("2026-11-19")).toBe(false);
    expect(isHolidayDate("2027-11-25")).toBe(true); // Thanksgiving 2027
  });
});

describe("hoursBetween", () => {
  it("computes ordinary shifts including odd minutes", () => {
    expect(hoursBetween("08:00", "16:00")).toBe(8);
    expect(hoursBetween("08:22", "16:30")).toBe(8.13);
  });

  it("treats an earlier time out as an overnight shift", () => {
    expect(hoursBetween("22:00", "06:00")).toBe(8);
  });

  it("rejects invalid times", () => {
    expect(hoursBetween("25:00", "16:00")).toBeNull();
    expect(hoursBetween("8:00", "16:00")).toBeNull(); // must be zero-padded HH:MM
    expect(hoursBetween("", "16:00")).toBeNull();
  });
});

describe("payPeriodContaining", () => {
  it("matches the first and last rows of Molly's pay period calendar", () => {
    // Her calendar lists the Saturday time and mileage are due.
    expect(payPeriodContaining("2024-07-13")).toEqual({ start: "2024-06-30", end: "2024-07-13" });
    expect(payPeriodContaining("2025-12-27")).toEqual({ start: "2025-12-14", end: "2025-12-27" });
  });

  it("finds the open period from a date in the middle of it", () => {
    expect(payPeriodContaining("2026-09-15")).toEqual({ start: "2026-09-06", end: "2026-09-19" });
  });

  it("starts a period on the Sunday and ends it on the Saturday", () => {
    expect(payPeriodContaining("2026-09-06")?.start).toBe("2026-09-06");
    expect(payPeriodContaining("2026-09-19")?.end).toBe("2026-09-19");
    expect(payPeriodContaining("2026-09-20")).toEqual({ start: "2026-09-20", end: "2026-10-03" });
  });

  it("works for dates before the calendar begins", () => {
    expect(payPeriodContaining("2024-06-29")).toEqual({ start: "2024-06-16", end: "2024-06-29" });
  });

  it("is null for malformed dates", () => {
    expect(payPeriodContaining("not-a-date")).toBeNull();
  });
});
