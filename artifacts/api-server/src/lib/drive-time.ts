// When drive time may be billed.
//
// Molly, 11 Sep 2026: "we are not able to bill for drive time to st Lukes
// unless its related to hospital at home (HAH) or Hospice." Drive time on any
// other day is work the client will not pay for, so billing it would put a
// line on the invoice that St. Luke's rejects.
//
// Both the invoice and the reconciliation report have to reach the same
// verdict — reconciliation exists precisely to tie back to the invoice total —
// so the rule lives here and neither of them implements it twice.

export const DRIVE_TIME = "drive-time";

/** The work drive time has to accompany to be billable. */
export const DRIVE_TIME_COMPANIONS = ["hospital-at-home", "hospice"];

export const DRIVE_TIME_UNBILLABLE_NOTE =
  "Not billable — no Hospital at Home or hospice visit for this employee that day";

type EntryLike = {
  employeeId: string;
  date: string;
  visitType: string | null;
};

const dayKey = (entry: EntryLike) => `${entry.employeeId}|${entry.date}`;

/**
 * Employee-days that carry Hospital at Home or hospice work, as
 * "employeeId|date". Build it from the same entry list being billed, so drive
 * time is judged against the day it actually belongs to.
 */
export function daysWithDriveTimeWork(entries: EntryLike[]): Set<string> {
  const days = new Set<string>();
  for (const entry of entries) {
    if (entry.visitType && DRIVE_TIME_COMPANIONS.includes(entry.visitType)) {
      days.add(dayKey(entry));
    }
  }
  return days;
}

/**
 * Why this entry can't be billed, or undefined when it can. Only drive time
 * is ever refused here; everything else bills on its own terms.
 */
export function unbillableReason(
  entry: EntryLike,
  daysWithWork: Set<string>,
): string | undefined {
  if (entry.visitType !== DRIVE_TIME) return undefined;
  return daysWithWork.has(dayKey(entry)) ? undefined : DRIVE_TIME_UNBILLABLE_NOTE;
}
