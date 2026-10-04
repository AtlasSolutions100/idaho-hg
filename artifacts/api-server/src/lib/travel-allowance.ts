// Per-day travel allowances.
//
// Molly, 11 Sep 2026, on Current PT: "Travel for Current is per day worked...
// specific to each employee and each clinic location, in place of mileage -
// not in addition to (Its calculated as round trip mileage at .65/mi minus 25
// miles when travel is >1 hour from house to clinic per our contract). This is
// also requested by client as separate line item."
//
// The allowance is stored as billable miles, so the money is miles x whichever
// mileage rate applies — the client's for the invoice, the employee's for pay.
import { and, eq } from "drizzle-orm";
import {
  db,
  employeeTravelAllowancesTable,
  type EmployeeTravelAllowanceRow,
} from "@workspace/db";
import { pickForDate } from "./rate-lookup";

export type TravelDayEntry = {
  employeeId: string;
  employeeName: string;
  employeeRole: string;
  clientId: string;
  clientName: string;
  date: string;
  travelLocation: string | null;
};

export type TravelDay = {
  employeeId: string;
  employeeName: string;
  employeeRole: string;
  clientId: string;
  clientName: string;
  location: string;
  date: string;
};

/**
 * One travel day per employee, location and date — "per day worked", however
 * many entries that day produced. A PT who logs two stretches at Fruitland is
 * owed one allowance, not two.
 */
export function travelDays(entries: TravelDayEntry[]): TravelDay[] {
  const seen = new Map<string, TravelDay>();
  for (const entry of entries) {
    if (!entry.travelLocation) continue;
    const key = [entry.employeeId, entry.travelLocation, entry.date].join("|");
    if (seen.has(key)) continue;
    seen.set(key, {
      employeeId: entry.employeeId,
      employeeName: entry.employeeName,
      employeeRole: entry.employeeRole,
      clientId: entry.clientId,
      clientName: entry.clientName,
      location: entry.travelLocation,
      date: entry.date,
    });
  }
  // Stable order so invoice and payroll lines come out the same way twice.
  return [...seen.values()].sort(
    (a, b) =>
      a.employeeName.localeCompare(b.employeeName) ||
      a.location.localeCompare(b.location) ||
      (a.date < b.date ? -1 : a.date > b.date ? 1 : 0),
  );
}

/** The allowance in effect for one employee at one location on a date. */
export async function getTravelAllowanceForDate(
  employeeId: string,
  clientId: string,
  location: string,
  date: string,
): Promise<EmployeeTravelAllowanceRow | undefined> {
  const rows = await db
    .select()
    .from(employeeTravelAllowancesTable)
    .where(
      and(
        eq(employeeTravelAllowancesTable.employeeId, employeeId),
        eq(employeeTravelAllowancesTable.clientId, clientId),
        eq(employeeTravelAllowancesTable.location, location),
      ),
    );
  return pickForDate(rows, date);
}
