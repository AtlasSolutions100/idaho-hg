import { describe, it, expect } from "vitest";
import { hoursBetween, isHolidayDate, isValidDateString, isWeekendDate } from "./work-calendar";

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
