/**
 * Server-side weekend/holiday determination for time entries. Employees no
 * longer pick rate multipliers on the form — the date decides.
 *
 * Holidays are the six commonly paid US holidays: New Year's Day, Memorial
 * Day, Independence Day, Labor Day, Thanksgiving, and Christmas.
 */

/** Parse "YYYY-MM-DD" into date parts, rejecting impossible dates like 2026-02-30. */
function parseDate(date: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  // Round-trip check: JS Date normalizes overflow (Feb 30 → Mar 2), so a
  // changed component means the input wasn't a real calendar date.
  const check = new Date(y, m - 1, d);
  if (check.getFullYear() !== y || check.getMonth() !== m - 1 || check.getDate() !== d) {
    return null;
  }
  return { y, m, d };
}

/** True when the string is a real calendar date in YYYY-MM-DD form. */
export function isValidDateString(date: string): boolean {
  return parseDate(date) !== null;
}

export function isWeekendDate(date: string): boolean {
  const p = parseDate(date);
  if (!p) return false;
  const day = new Date(p.y, p.m - 1, p.d).getDay();
  return day === 0 || day === 6;
}

/** Nth (1-based) occurrence of a weekday (0=Sun..6=Sat) in a month. */
function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  const first = new Date(year, month - 1, 1).getDay();
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
}

/** Last occurrence of a weekday in a month. */
function lastWeekday(year: number, month: number, weekday: number): number {
  const lastDay = new Date(year, month, 0); // day 0 of next month
  return lastDay.getDate() - ((lastDay.getDay() - weekday + 7) % 7);
}

export function isHolidayDate(date: string): boolean {
  const p = parseDate(date);
  if (!p) return false;
  const { y, m, d } = p;
  if (m === 1 && d === 1) return true; // New Year's Day
  if (m === 5 && d === lastWeekday(y, 5, 1)) return true; // Memorial Day (last Mon of May)
  if (m === 7 && d === 4) return true; // Independence Day
  if (m === 9 && d === nthWeekday(y, 9, 1, 1)) return true; // Labor Day (1st Mon of Sep)
  if (m === 11 && d === nthWeekday(y, 11, 4, 4)) return true; // Thanksgiving (4th Thu of Nov)
  if (m === 12 && d === 25) return true; // Christmas
  return false;
}

const TIME_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/**
 * Hours between two "HH:MM" clock times, rounded to 2 decimals. A timeOut at
 * or before timeIn is treated as crossing midnight (overnight shift).
 * Returns null for invalid input.
 */
export function hoursBetween(timeIn: string, timeOut: string): number | null {
  if (!TIME_PATTERN.test(timeIn) || !TIME_PATTERN.test(timeOut)) return null;
  const [inH, inM] = timeIn.split(":").map(Number);
  const [outH, outM] = timeOut.split(":").map(Number);
  let minutes = outH! * 60 + outM! - (inH! * 60 + inM!);
  if (minutes <= 0) minutes += 24 * 60;
  return Math.round((minutes / 60) * 100) / 100;
}

/**
 * Molly's pay periods: two weeks, Sunday through Saturday, with time and
 * mileage due on the closing Saturday and payday the Friday after. Anchored on
 * the first row of her pay period calendar (time and mileage due 2024-07-13).
 */
const PAY_PERIOD_ANCHOR_END = Date.UTC(2024, 6, 13);
const PAY_PERIOD_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

function isoFromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The pay period a date falls in, as inclusive YYYY-MM-DD bounds, or null for
 * a malformed date. Computed in UTC days so a daylight-saving change can't
 * shift a boundary.
 */
export function payPeriodContaining(date: string): { start: string; end: string } | null {
  const p = parseDate(date);
  if (!p) return null;
  const day = Date.UTC(p.y, p.m - 1, p.d);
  // The containing period closes on the first anchor-aligned Saturday on or
  // after the date.
  const offsetDays = Math.round((day - PAY_PERIOD_ANCHOR_END) / DAY_MS);
  const periodsAhead = Math.ceil(offsetDays / PAY_PERIOD_DAYS);
  const end = PAY_PERIOD_ANCHOR_END + periodsAhead * PAY_PERIOD_DAYS * DAY_MS;
  return {
    start: isoFromUtc(end - (PAY_PERIOD_DAYS - 1) * DAY_MS),
    end: isoFromUtc(end),
  };
}
