import { Router, type IRouter } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  db,
  clientRatesTable,
  clientPayRatesTable,
  visitPayRatesTable,
  employeeRatesTable,
  clientsTable,
  employeesTable,
  type ClientRateRow,
  type ClientPayRateRow,
  type EmployeeRateRow,
  appliedBackfillsTable,
} from "@workspace/db";
import { mileageCorrections } from "../lib/staff-mileage";
import { payPeriodContaining } from "../lib/work-calendar";
import {
  CreateClientRateBody,
  CreateClientPayRateBody,
  UpdateClientRateBody,
  UpdateEmployeeRateBody,
} from "@workspace/api-zod";
import {
  hasDemoEmployeeData,
  purgeDemoEmployeeData,
} from "../lib/demo-cleanup";
import { requireAdmin } from "../lib/employee-auth";

const router: IRouter = Router();

function serializeClientRate(row: ClientRateRow) {
  return {
    id: String(row.id),
    clientId: row.clientId,
    clientName: row.clientName,
    visitType: row.visitType,
    rate: row.rate,
    effectiveDate: row.effectiveDate,
  };
}

function serializeClientPayRate(row: ClientPayRateRow) {
  return {
    id: String(row.id),
    clientId: row.clientId,
    clientName: row.clientName,
    visitType: row.visitType,
    rate: row.rate,
    effectiveDate: row.effectiveDate,
  };
}

function serializeEmployeeRate(row: EmployeeRateRow) {
  return {
    id: String(row.id),
    employeeId: row.employeeId,
    employeeName: row.employeeName,
    employeeRole: row.employeeRole,
    hourlyRate: row.hourlyRate,
    visitRate: row.visitRate,
    mileageRate: row.mileageRate,
    perDiemRate: row.perDiemRate,
    weekendMultiplier: row.weekendMultiplier,
    holidayMultiplier: row.holidayMultiplier,
    effectiveDate: row.effectiveDate,
  };
}

// Rates are stored as append-only history: every change inserts a new row
// with its own effective date. The "current" rate for a client/visit-type or
// employee is the row with the latest effective date (ties broken by newest id).
function isNewerRate(
  a: { effectiveDate: string; id: number },
  b: { effectiveDate: string; id: number },
) {
  if (a.effectiveDate !== b.effectiveDate) return a.effectiveDate > b.effectiveDate;
  return a.id > b.id;
}

function latestPerGroup<T extends { effectiveDate: string; id: number }>(
  rows: T[],
  keyOf: (row: T) => string,
): T[] {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const key = keyOf(row);
    const existing = latest.get(key);
    if (!existing || isNewerRate(row, existing)) {
      latest.set(key, row);
    }
  }
  return [...latest.values()];
}

// Seed initial rates on first use so Molly starts from the current known rates.
// Per-visit rates use the visit type string. Hourly rates use "hourly" (generic)
// or "hourly-{ROLE}" (role-specific, used for clients like Weiser that bill
// differently by discipline). The invoice route tries the role-specific key first,
// then falls back to "hourly", so both patterns work automatically.
const seedClientRates = [
  // St. Luke's — primarily per-visit
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "skilled-nursing", rate: 95, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "physical-therapy", rate: 105, effectiveDate: "2024-01-01" },
  // Weiser Memorial — per-visit + role-specific hourly billing
  { clientId: "2", clientName: "Weiser Memorial Hospital", visitType: "skilled-nursing", rate: 88, effectiveDate: "2024-01-01" },
  { clientId: "2", clientName: "Weiser Memorial Hospital", visitType: "physical-therapy", rate: 98, effectiveDate: "2024-01-01" },
  { clientId: "2", clientName: "Weiser Memorial Hospital", visitType: "hourly-RN", rate: 81.5, effectiveDate: "2024-01-01" },
  { clientId: "2", clientName: "Weiser Memorial Hospital", visitType: "hourly-PT", rate: 84, effectiveDate: "2024-01-01" },
  { clientId: "2", clientName: "Weiser Memorial Hospital", visitType: "hourly-OT", rate: 77, effectiveDate: "2024-01-01" },
  { clientId: "2", clientName: "Weiser Memorial Hospital", visitType: "hourly-SLP", rate: 88, effectiveDate: "2024-01-01" },
  { clientId: "2", clientName: "Weiser Memorial Hospital", visitType: "hourly-PTA", rate: 58, effectiveDate: "2024-01-01" },
  { clientId: "2", clientName: "Weiser Memorial Hospital", visitType: "hourly-LPN", rate: 55, effectiveDate: "2024-01-01" },
  // Idaho Youth Ranch — skilled-nursing visits + RN hourly
  { clientId: "3", clientName: "Idaho Youth Ranch", visitType: "skilled-nursing", rate: 82, effectiveDate: "2024-01-01" },
  { clientId: "3", clientName: "Idaho Youth Ranch", visitType: "hourly-RN", rate: 93, effectiveDate: "2024-01-01" },
  // Treasure Valley Outpatient — visit rates + general hourly (PT-led)
  { clientId: "4", clientName: "Treasure Valley Outpatient Clinic", visitType: "physical-therapy", rate: 92, effectiveDate: "2024-01-01" },
  { clientId: "4", clientName: "Treasure Valley Outpatient Clinic", visitType: "occupational-therapy", rate: 90, effectiveDate: "2024-01-01" },
  { clientId: "4", clientName: "Treasure Valley Outpatient Clinic", visitType: "hourly", rate: 69, effectiveDate: "2024-01-01" },
  // Meridian Senior Care (id 5) is not a real client — no rates seeded.
  // Current PT — hourly PT billing
  { clientId: "6", clientName: "Current PT", visitType: "hourly-PT", rate: 69, effectiveDate: "2024-01-01" },
  // Thrive — hourly PT billing
  { clientId: "7", clientName: "Thrive", visitType: "hourly-PT", rate: 69.98, effectiveDate: "2024-01-01" },
];

// Placeholder starting pay rates per discipline — Molly sets real numbers on
// the Employee Rates page (each change is tracked with an effective date).
const roleDefaultRates: Record<string, { hourlyRate: number; visitRate: number }> = {
  PT: { hourlyRate: 52, visitRate: 82 },
  RN: { hourlyRate: 48, visitRate: 75 },
  OT: { hourlyRate: 50, visitRate: 78 },
  PTA: { hourlyRate: 40, visitRate: 60 },
  SLP: { hourlyRate: 52, visitRate: 82 },
  LCSW: { hourlyRate: 50, visitRate: 75 },
};

const seedEmployeeRoster: Array<{ employeeId: string; employeeName: string; employeeRole: string }> = [
  { employeeId: "ed7ff5a6-408c-46ae-a6d1-f8fb6ec85b1b", employeeName: "Molly Hodge", employeeRole: "PT" },
  { employeeId: "70a76167-a476-4268-a2fc-d89c7ed15e6e", employeeName: "Dale Gibbs", employeeRole: "PT" },
  { employeeId: "149d3f0a-08dc-48e4-a2d5-5f74df82e9ba", employeeName: "Emily Greer", employeeRole: "PT" },
  { employeeId: "c173f799-2391-4acb-b7d8-bd6c1f7811ca", employeeName: "Quinton Erhard", employeeRole: "PT" },
  { employeeId: "e2ae91e4-d3d8-4447-b4ce-85de035b6700", employeeName: "Adrian Eddins", employeeRole: "RN" },
  { employeeId: "671910f2-7fa0-4eae-8b61-717191a00bab", employeeName: "Ronda Stewart", employeeRole: "RN" },
  { employeeId: "e0abb6d8-30a9-4cbd-a777-ac134f373872", employeeName: "Amber Edwards", employeeRole: "RN" },
  { employeeId: "cdd04b02-8b43-4b1d-9da6-b394a67cfdfc", employeeName: "Sandy Clayton", employeeRole: "RN" },
  { employeeId: "0b970f7e-1788-4b52-be50-811ad8ce9b9a", employeeName: "Bree Whiting", employeeRole: "RN" },
  { employeeId: "42f630fa-1049-4a46-8a65-70ffcfbe98d5", employeeName: "Brandon Whiting", employeeRole: "OT" },
  { employeeId: "782448f4-2acd-4ee1-a40f-80d930ebcd7f", employeeName: "Joshua Johansen", employeeRole: "OT" },
  { employeeId: "5cc9fff2-5c2e-41cd-bd56-50cce1a5532d", employeeName: "Lee Hamilton", employeeRole: "OT" },
  { employeeId: "1d2c2efe-bed4-4b2e-aba4-194130b0a0b7", employeeName: "Lee Ormsby", employeeRole: "PTA" },
  { employeeId: "1da47ea1-da22-41f3-aef2-542c42d47a21", employeeName: "Ameliana Samarin", employeeRole: "SLP" },
  { employeeId: "5f4d261e-28c3-4bea-a6e4-99e171ac07c0", employeeName: "Mel Plourde", employeeRole: "LCSW" },
  { employeeId: "d324d661-8c8c-4414-be27-855f48d4ed26", employeeName: "Paige Barbero", employeeRole: "PT" },
];

const seedEmployeeRates = seedEmployeeRoster.map((emp) => {
  const defaults = roleDefaultRates[emp.employeeRole] ?? { hourlyRate: 45, visitRate: 70 };
  return {
    ...emp,
    ...defaults,
    // What every employee is reimbursed per mile. The master rate sheet said
    // $0.69, but that was what Molly paid herself and Adrian before she had
    // staff; staff are paid $0.65 (confirmed 2026-09-15). Clients are billed
    // separately, at the GSA-based client mileage rate.
    mileageRate: 0.65,
    perDiemRate: 45,
    weekendMultiplier: 1.5,
    holidayMultiplier: 2,
    effectiveDate: "2024-01-01",
  };
});

// Rates for clients added after the original seed. Existing (non-empty)
// databases skip the full seed, so these are backfilled idempotently: a rate
// is inserted only if the client has no history rows for that rate type.
const backfillClientRates = [
  { clientId: "6", clientName: "Current PT", visitType: "hourly-PT", rate: 69, effectiveDate: "2024-01-01" },
  { clientId: "7", clientName: "Thrive", visitType: "hourly-PT", rate: 69.98, effectiveDate: "2024-01-01" },
  // Weiser Memorial role-specific hourly rates (confirmed by Molly)
  { clientId: "2", clientName: "Weiser Memorial Hospital", visitType: "hourly-RN", rate: 81.5, effectiveDate: "2024-01-01" },
  { clientId: "2", clientName: "Weiser Memorial Hospital", visitType: "hourly-PT", rate: 84, effectiveDate: "2024-01-01" },
  { clientId: "2", clientName: "Weiser Memorial Hospital", visitType: "hourly-OT", rate: 77, effectiveDate: "2024-01-01" },
  { clientId: "2", clientName: "Weiser Memorial Hospital", visitType: "hourly-SLP", rate: 88, effectiveDate: "2024-01-01" },
  { clientId: "2", clientName: "Weiser Memorial Hospital", visitType: "hourly-PTA", rate: 58, effectiveDate: "2024-01-01" },
  { clientId: "2", clientName: "Weiser Memorial Hospital", visitType: "hourly-LPN", rate: 55, effectiveDate: "2024-01-01" },
  // Idaho Youth Ranch RN hourly
  { clientId: "3", clientName: "Idaho Youth Ranch", visitType: "hourly-RN", rate: 93, effectiveDate: "2024-01-01" },
  // Treasure Valley Outpatient general hourly (PT-led)
  { clientId: "4", clientName: "Treasure Valley Outpatient Clinic", visitType: "hourly", rate: 69, effectiveDate: "2024-01-01" },

  // St. Luke's — new visit types, discipline-specific billing rates (from master rate sheet)
  // Rates are stored as {visitType}-{ROLE} so the invoice route can try the
  // role-specific key first and fall back to the plain visitType if needed.
  // Routine visit
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "routine-visit-RN", rate: 126, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "routine-visit-PT", rate: 141, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "routine-visit-OT", rate: 141, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "routine-visit-SLP", rate: 141, effectiveDate: "2024-01-01" },
  // SOC
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "soc-RN", rate: 336, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "soc-PT", rate: 376, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "soc-OT", rate: 376, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "soc-SLP", rate: 376, effectiveDate: "2024-01-01" },
  // ROC
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "roc-RN", rate: 252, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "roc-PT", rate: 282, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "roc-OT", rate: 282, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "roc-SLP", rate: 282, effectiveDate: "2024-01-01" },
  // Recert / Recert RA
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "recert-RN", rate: 210, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "recert-PT", rate: 235, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "recert-OT", rate: 235, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "recert-SLP", rate: 235, effectiveDate: "2024-01-01" },
  // Discharge (DC)
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "discharge-RN", rate: 168, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "discharge-PT", rate: 188, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "discharge-OT", rate: 188, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "discharge-SLP", rate: 188, effectiveDate: "2024-01-01" },
  // Eval / Eval RA
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "eval-RN", rate: 210, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "eval-PT", rate: 235, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "eval-OT", rate: 235, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "eval-SLP", rate: 235, effectiveDate: "2024-01-01" },
  // Non-visit (doc/meeting)
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "non-visit-RN", rate: 84, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "non-visit-PT", rate: 94, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "non-visit-OT", rate: 94, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "non-visit-SLP", rate: 94, effectiveDate: "2024-01-01" },
  // Training
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "training-RN", rate: 84, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "training-PT", rate: 94, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "training-OT", rate: 79, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "training-SLP", rate: 94, effectiveDate: "2024-01-01" },
  // Non-billable visit
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "non-billable-RN", rate: 166, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "non-billable-PT", rate: 188.99, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "non-billable-OT", rate: 188, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "non-billable-SLP", rate: 188, effectiveDate: "2024-01-01" },
  // On Call
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "on-call-RN", rate: 10, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "on-call-PT", rate: 10, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "on-call-OT", rate: 10, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "on-call-SLP", rate: 10, effectiveDate: "2024-01-01" },
  // Hospital at Home
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "hospital-at-home-RN", rate: 84, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "hospital-at-home-PT", rate: 94, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "hospital-at-home-OT", rate: 94, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "hospital-at-home-SLP", rate: 94, effectiveDate: "2024-01-01" },
  // Drive time — billable to St. Luke's only on Hospital at Home or hospice
  // work, at the Hospital at Home rate, as its own line, with mileage billed
  // on top as for every visit (Molly, 2026-09-15).
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "drive-time-RN", rate: 84, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "drive-time-PT", rate: 94, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "drive-time-OT", rate: 94, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "drive-time-SLP", rate: 94, effectiveDate: "2024-01-01" },
  // Hospice
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "hospice-RN", rate: 84, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "hospice-PT", rate: 94, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "hospice-OT", rate: 94, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "hospice-SLP", rate: 94, effectiveDate: "2024-01-01" },
  // McCall Per Diem
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "mccall-per-diem-RN", rate: 300, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "mccall-per-diem-PT", rate: 300, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "mccall-per-diem-OT", rate: 300, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "mccall-per-diem-SLP", rate: 300, effectiveDate: "2024-01-01" },
  // MI&E first/last day
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "mie-first-last-day-RN", rate: 60, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "mie-first-last-day-PT", rate: 60, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "mie-first-last-day-OT", rate: 60, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "mie-first-last-day-SLP", rate: 60, effectiveDate: "2024-01-01" },
  // MI&E full day
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "mie-full-day-RN", rate: 80, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "mie-full-day-PT", rate: 80, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "mie-full-day-OT", rate: 80, effectiveDate: "2024-01-01" },
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "mie-full-day-SLP", rate: 80, effectiveDate: "2024-01-01" },
];

// Advisory lock key so concurrent server instances (or parallel test
// processes) can't both pass the exists-check and double-insert a backfill
// rate — the rates table has no unique constraint (it's append-only history).
const BACKFILL_LOCK_KEY = 727_301_632;

async function backfillMissingClientRates() {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${BACKFILL_LOCK_KEY})`);
    for (const seed of backfillClientRates) {
      const [existing] = await tx
        .select()
        .from(clientRatesTable)
        .where(
          and(
            eq(clientRatesTable.clientId, seed.clientId),
            eq(clientRatesTable.visitType, seed.visitType),
          ),
        )
        .limit(1);
      if (!existing) {
        await tx.insert(clientRatesTable).values(seed);
      }
    }
  });
}

// --- Molly's real rates from the master rate sheet ("Master sheet for Radiant
// AI") — St. Luke's discipline × visit-type PAY, per-client hourly PAY, Weiser's
// distinct weekend rows, and the St. Luke's/Weiser weekend-holiday multipliers.
// All applied idempotently (insert-if-missing / only-if-still-default).
const ST_LUKES_VISIT_PAY: Record<string, [number, number, number, number]> = {
  // [RN, PT, OT, SLP]
  "routine-visit": [100.8, 112.8, 112.8, 112.8],
  soc: [268.8, 300.8, 300.8, 300.8],
  roc: [201.6, 225.6, 225.6, 225.6],
  recert: [168, 188, 188, 188],
  discharge: [134.4, 150.4, 150.4, 150.4],
  eval: [168, 188, 188, 188],
  "non-visit": [67.2, 75.2, 75.2, 75.2],
  training: [67.2, 75.2, 63.2, 75.2],
  "non-billable": [132.8, 151.192, 150.4, 150.4],
  "on-call": [8, 8, 8, 8],
  "mccall-per-diem": [200, 200, 200, 200],
  "mie-first-last-day": [60, 60, 60, 60],
  "mie-full-day": [80, 80, 80, 80],
  "hospital-at-home": [67.2, 75.2, 75.2, 75.2],
  // Drive time on Hospital at Home / hospice work pays the Hospital at Home
  // rate, for every discipline (Molly, 2026-09-15).
  "drive-time": [67.2, 75.2, 75.2, 75.2],
  hospice: [67.2, 75.2, 75.2, 75.2],
};
const PAY_DISCIPLINES = ["RN", "PT", "OT", "SLP"] as const;

const seedVisitPayRates = Object.entries(ST_LUKES_VISIT_PAY).flatMap(([visitType, rates]) =>
  PAY_DISCIPLINES.map((discipline, i) => ({
    discipline,
    visitType,
    rate: rates[i]!,
    effectiveDate: "2024-01-01",
  })),
);

// Per-client hourly employee PAY (differs by client), plus Weiser's distinct
// weekend pay rows. Keyed like client_rates: "hourly-{DISC}" / "...-weekend".
const seedClientPayRates = [
  // Weiser Memorial (weekday)
  { clientId: "2", visitType: "hourly-RN", rate: 71 },
  { clientId: "2", visitType: "hourly-PT", rate: 71 },
  { clientId: "2", visitType: "hourly-OT", rate: 71 },
  { clientId: "2", visitType: "hourly-SLP", rate: 80 },
  { clientId: "2", visitType: "hourly-PTA", rate: 50 },
  { clientId: "2", visitType: "hourly-LPN", rate: 45 },
  // Weiser Memorial (weekend — distinct rate rows)
  { clientId: "2", visitType: "hourly-RN-weekend", rate: 78 },
  { clientId: "2", visitType: "hourly-PT-weekend", rate: 78 },
  { clientId: "2", visitType: "hourly-OT-weekend", rate: 78 },
  { clientId: "2", visitType: "hourly-SLP-weekend", rate: 88 },
  { clientId: "2", visitType: "hourly-PTA-weekend", rate: 58 },
  { clientId: "2", visitType: "hourly-LPN-weekend", rate: 53 },
  // Idaho Youth Ranch
  { clientId: "3", visitType: "hourly-RN", rate: 71 },
  { clientId: "3", visitType: "hourly-LCSW", rate: 71 },
  // Current PT / Thrive
  { clientId: "6", visitType: "hourly-PT", rate: 57 },
  { clientId: "7", visitType: "hourly-PT", rate: 57.2 },
];

// Weiser's distinct weekend BILLING rows (base hourly billing already seeded).
const seedWeiserWeekendBilling = [
  { clientId: "2", clientName: "Weiser Memorial Hospital", visitType: "hourly-RN-weekend", rate: 101.5, effectiveDate: "2024-01-01" },
  { clientId: "2", clientName: "Weiser Memorial Hospital", visitType: "hourly-PT-weekend", rate: 104, effectiveDate: "2024-01-01" },
  { clientId: "2", clientName: "Weiser Memorial Hospital", visitType: "hourly-OT-weekend", rate: 97, effectiveDate: "2024-01-01" },
  { clientId: "2", clientName: "Weiser Memorial Hospital", visitType: "hourly-SLP-weekend", rate: 108, effectiveDate: "2024-01-01" },
  { clientId: "2", clientName: "Weiser Memorial Hospital", visitType: "hourly-PTA-weekend", rate: 78, effectiveDate: "2024-01-01" },
  { clientId: "2", clientName: "Weiser Memorial Hospital", visitType: "hourly-LPN-weekend", rate: 75, effectiveDate: "2024-01-01" },
  // St. Luke's mileage billing at the GSA-based $0.725 (staff are reimbursed $0.65).
  { clientId: "1", clientName: "St. Luke's Health System", visitType: "mileage", rate: 0.725, effectiveDate: "2024-01-01" },
];

// Per-client weekend/holiday multipliers: only set when still at the default 1,
// so Molly's later admin edits are never overwritten.
const clientDayMultipliers: Array<{ clientId: string; weekend: number; holiday: number }> = [
  { clientId: "1", weekend: 1.1, holiday: 1.1 }, // St. Luke's: +10% for both
  { clientId: "2", weekend: 1, holiday: 1.5 }, // Weiser: explicit weekend rows; holidays 1.5x
  // Idaho Youth Ranch carries the same footnote as Weiser on Molly's master
  // sheet — time and a half on New Year's, Memorial Day, Independence Day,
  // Labor Day, Thanksgiving and Christmas, exactly the six days
  // work-calendar.ts treats as holidays — and bills the client 1.5x too
  // (Molly, 2026-09-15).
  { clientId: "3", weekend: 1, holiday: 1.5 },
];

async function backfillMollyRates() {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${BACKFILL_LOCK_KEY})`);
    // Client billing weekend rows + St. Luke's mileage.
    for (const seed of seedWeiserWeekendBilling) {
      const [ex] = await tx.select().from(clientRatesTable)
        .where(and(eq(clientRatesTable.clientId, seed.clientId), eq(clientRatesTable.visitType, seed.visitType))).limit(1);
      if (!ex) await tx.insert(clientRatesTable).values(seed);
    }
    // St. Luke's visit PAY matrix.
    for (const seed of seedVisitPayRates) {
      const [ex] = await tx.select().from(visitPayRatesTable)
        .where(and(eq(visitPayRatesTable.discipline, seed.discipline), eq(visitPayRatesTable.visitType, seed.visitType))).limit(1);
      if (!ex) await tx.insert(visitPayRatesTable).values(seed);
    }
    // Per-client hourly PAY.
    const clientName = new Map(
      (await tx.select().from(clientsTable)).map((c) => [c.id, c.name] as const),
    );
    for (const seed of seedClientPayRates) {
      const [ex] = await tx.select().from(clientPayRatesTable)
        .where(and(eq(clientPayRatesTable.clientId, seed.clientId), eq(clientPayRatesTable.visitType, seed.visitType))).limit(1);
      if (!ex) {
        await tx.insert(clientPayRatesTable).values({
          clientId: seed.clientId,
          clientName: clientName.get(seed.clientId) ?? seed.clientId,
          visitType: seed.visitType,
          rate: seed.rate,
          effectiveDate: "2024-01-01",
        });
      }
    }
    // Per-client multipliers — only when still the default 1.
    for (const m of clientDayMultipliers) {
      await tx.update(clientsTable)
        .set({ weekendMultiplier: m.weekend, holidayMultiplier: m.holiday })
        .where(and(
          eq(clientsTable.id, m.clientId),
          eq(clientsTable.weekendMultiplier, 1),
          eq(clientsTable.holidayMultiplier, 1),
        ));
    }
  });
}

// --- One-time corrections to rates this app seeded wrong. Each runs once per
// database (a marker row in applied_backfills) inside one transaction with its
// marker, so a correction that fails is retried on the next boot rather than
// recorded as done.

/**
 * Drive time was first seeded to pay an RN $33.60/hr — lifted from the
 * HAH/HOS drive column of Molly's sample RN payroll sheet, a figure she
 * doesn't recognise. Drive time pays the Hospital at Home rate. Only that
 * exact seeded row is corrected: a rate Molly has set herself is a separate
 * history row and stays as she left it. Returns how many rows changed.
 */
export async function backfillDriveTimePayRate(): Promise<number> {
  return db.transaction(async (tx) => {
    const [marker] = await tx
      .insert(appliedBackfillsTable)
      .values({ name: "drive-time-pays-hospital-at-home-rate" })
      .onConflictDoNothing()
      .returning();
    if (!marker) return 0;
    const fixed = await tx
      .update(visitPayRatesTable)
      .set({ rate: 67.2 })
      .where(
        and(
          eq(visitPayRatesTable.discipline, "RN"),
          eq(visitPayRatesTable.visitType, "drive-time"),
          eq(visitPayRatesTable.effectiveDate, "2024-01-01"),
          // `rate` is single precision, so 33.6 is stored as 33.5999984...;
          // an equality test would match nothing.
          sql`abs(${visitPayRatesTable.rate} - 33.6) < 0.001`,
        ),
      )
      .returning();
    return fixed.length;
  });
}

/**
 * Staff mileage was seeded at $0.69/mi off the rate sheet; every employee is
 * paid $0.65. Rates are history, so this adds a $0.65 row per employee rather
 * than rewriting the old one, effective the first day of the pay period open
 * when it runs — the period nobody has been paid for yet, and never one they
 * have. `today` is injectable for tests. Returns how many rows it added.
 */
export async function backfillStaffMileageRate(
  today: string = new Date().toISOString().slice(0, 10),
): Promise<number> {
  return db.transaction(async (tx) => {
    const [marker] = await tx
      .insert(appliedBackfillsTable)
      .values({ name: "staff-mileage-65-cents" })
      .onConflictDoNothing()
      .returning();
    if (!marker) return 0;
    const period = payPeriodContaining(today);
    if (!period) return 0;
    const corrections = mileageCorrections(
      await tx.select().from(employeeRatesTable),
      period.start,
    );
    if (corrections.length > 0) {
      await tx.insert(employeeRatesTable).values(corrections);
    }
    return corrections.length;
  });
}

let seeded = false;
export async function ensureSeeded() {
  if (seeded) return;
  // Guard: if legacy demo employees (IDs "1"–"6") resurfaced (e.g. via a
  // restored backup), purge them and skip seeding — the database is not
  // fresh, so seeding would only mix demo remnants with real data.
  if (await hasDemoEmployeeData()) {
    await purgeDemoEmployeeData();
    seeded = true;
    return;
  }
  const [clientRow] = await db.select().from(clientRatesTable).limit(1);
  if (!clientRow) {
    await db.insert(clientRatesTable).values(seedClientRates);
  }
  const [employeeRow] = await db.select().from(employeeRatesTable).limit(1);
  if (!employeeRow) {
    await db.insert(employeeRatesTable).values(seedEmployeeRates);
  }
  await backfillMissingClientRates();
  await backfillMollyRates();
  await backfillDriveTimePayRate();
  await backfillStaffMileageRate();
  seeded = true;
}


// Rate tables expose company pay/billing data and are only read or written
// from Molly's admin screens — every route here is admin-gated.
router.get("/client-rates", requireAdmin, async (_req, res, next) => {
  try {
    await ensureSeeded();
    const rows = await db.select().from(clientRatesTable);
    // Hide rates for removed (inactive) clients; unknown ids stay visible.
    const inactive = new Set(
      (await db.select().from(clientsTable).where(eq(clientsTable.active, false))).map((c) => c.id),
    );
    const current = latestPerGroup(rows.filter((r) => !inactive.has(r.clientId)), (row) => `${row.clientId}::${row.visitType}`)
      .sort((a, b) =>
        a.clientName.localeCompare(b.clientName) || a.visitType.localeCompare(b.visitType),
      );
    res.json(current.map(serializeClientRate));
  } catch (err) {
    next(err);
  }
});

// Adds a new rate type for an existing client (e.g. an hourly rate). Rejects
// duplicates: once a client has any history rows for a rate type, changes go
// through PATCH so the history stays append-only.
router.post("/client-rates", requireAdmin, async (req, res, next) => {
  try {
    await ensureSeeded();
    const parsed = CreateClientRateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid rate" });
      return;
    }
    const { clientId, rateType, discipline, rate, effectiveDate } = parsed.data;
    // When a discipline is supplied the stored key is "{rateType}-{discipline}"
    // (e.g. "soc-RN").  The invoice route tries the discipline-specific key
    // first and falls back to the plain rateType so clients with a single rate
    // per visit type continue to work without any changes.
    const storedType = discipline ? `${rateType}-${discipline}` : rateType;
    const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
    if (!client || !client.active) {
      res.status(404).json({ message: "Client not found" });
      return;
    }
    const [existing] = await db
      .select()
      .from(clientRatesTable)
      .where(
        and(eq(clientRatesTable.clientId, clientId), eq(clientRatesTable.visitType, storedType)),
      )
      .limit(1);
    if (existing) {
      res
        .status(409)
        .json({ message: "This client already has a rate of this type — edit it instead" });
      return;
    }
    const [row] = await db
      .insert(clientRatesTable)
      .values({
        clientId,
        clientName: client.name,
        visitType: storedType,
        rate,
        effectiveDate,
      })
      .returning();
    res.status(201).json(serializeClientRate(row));
  } catch (err) {
    next(err);
  }
});

// Editing a rate never overwrites: it inserts a new history row so past
// payroll/invoices can still resolve the rate that applied on their dates.
router.patch("/client-rates/:id", requireAdmin, async (req, res, next) => {
  try {
    const parsed = UpdateClientRateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid rate update" });
      return;
    }
    const numericId = Number(req.params.id);
    if (!Number.isInteger(numericId)) {
      res.status(404).json({ message: "Rate not found" });
      return;
    }
    const [existing] = await db
      .select()
      .from(clientRatesTable)
      .where(eq(clientRatesTable.id, numericId));
    if (!existing) {
      res.status(404).json({ message: "Rate not found" });
      return;
    }
    const [row] = await db
      .insert(clientRatesTable)
      .values({
        clientId: existing.clientId,
        clientName: existing.clientName,
        visitType: existing.visitType,
        rate: parsed.data.rate,
        effectiveDate: parsed.data.effectiveDate,
      })
      .returning();
    res.json(serializeClientRate(row));
  } catch (err) {
    next(err);
  }
});

router.get("/client-rates/:id/history", requireAdmin, async (req, res, next) => {
  try {
    await ensureSeeded();
    const numericId = Number(req.params.id);
    if (!Number.isInteger(numericId)) {
      res.status(404).json({ message: "Rate not found" });
      return;
    }
    const [existing] = await db
      .select()
      .from(clientRatesTable)
      .where(eq(clientRatesTable.id, numericId));
    if (!existing) {
      res.status(404).json({ message: "Rate not found" });
      return;
    }
    const rows = await db
      .select()
      .from(clientRatesTable)
      .where(
        and(
          eq(clientRatesTable.clientId, existing.clientId),
          eq(clientRatesTable.visitType, existing.visitType),
        ),
      )
      .orderBy(desc(clientRatesTable.effectiveDate), desc(clientRatesTable.id));
    res.json(rows.map(serializeClientRate));
  } catch (err) {
    next(err);
  }
});

// ---- Per-client employee PAY rates (hourly pay that differs by client) ----

router.get("/client-pay-rates", requireAdmin, async (_req, res, next) => {
  try {
    await ensureSeeded();
    const rows = await db.select().from(clientPayRatesTable);
    const inactive = new Set(
      (await db.select().from(clientsTable).where(eq(clientsTable.active, false))).map((c) => c.id),
    );
    const current = latestPerGroup(
      rows.filter((r) => !inactive.has(r.clientId)),
      (row) => `${row.clientId}::${row.visitType}`,
    ).sort(
      (a, b) => a.clientName.localeCompare(b.clientName) || a.visitType.localeCompare(b.visitType),
    );
    res.json(current.map(serializeClientPayRate));
  } catch (err) {
    next(err);
  }
});

router.post("/client-pay-rates", requireAdmin, async (req, res, next) => {
  try {
    await ensureSeeded();
    const parsed = CreateClientPayRateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid pay rate" });
      return;
    }
    const { clientId, rateType, discipline, rate, effectiveDate } = parsed.data;
    const storedType = discipline ? `${rateType}-${discipline}` : rateType;
    const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
    if (!client || !client.active) {
      res.status(404).json({ message: "Client not found" });
      return;
    }
    const [existing] = await db
      .select()
      .from(clientPayRatesTable)
      .where(
        and(
          eq(clientPayRatesTable.clientId, clientId),
          eq(clientPayRatesTable.visitType, storedType),
        ),
      )
      .limit(1);
    if (existing) {
      res
        .status(409)
        .json({ message: "This client already has a pay rate of this type — edit it instead" });
      return;
    }
    const [row] = await db
      .insert(clientPayRatesTable)
      .values({ clientId, clientName: client.name, visitType: storedType, rate, effectiveDate })
      .returning();
    res.status(201).json(serializeClientPayRate(row));
  } catch (err) {
    next(err);
  }
});

router.patch("/client-pay-rates/:id", requireAdmin, async (req, res, next) => {
  try {
    const parsed = UpdateClientRateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid rate update" });
      return;
    }
    const numericId = Number(req.params.id);
    if (!Number.isInteger(numericId)) {
      res.status(404).json({ message: "Rate not found" });
      return;
    }
    const [existing] = await db
      .select()
      .from(clientPayRatesTable)
      .where(eq(clientPayRatesTable.id, numericId));
    if (!existing) {
      res.status(404).json({ message: "Rate not found" });
      return;
    }
    const [row] = await db
      .insert(clientPayRatesTable)
      .values({
        clientId: existing.clientId,
        clientName: existing.clientName,
        visitType: existing.visitType,
        rate: parsed.data.rate,
        effectiveDate: parsed.data.effectiveDate,
      })
      .returning();
    res.json(serializeClientPayRate(row));
  } catch (err) {
    next(err);
  }
});

router.get("/employee-rates", requireAdmin, async (_req, res, next) => {
  try {
    await ensureSeeded();
    const rows = await db.select().from(employeeRatesTable);
    // Hide rates for removed (inactive) employees; unknown ids stay visible.
    const inactive = new Set(
      (await db.select().from(employeesTable).where(eq(employeesTable.active, false))).map((e) => e.id),
    );
    const current = latestPerGroup(rows.filter((r) => !inactive.has(r.employeeId)), (row) => row.employeeId).sort((a, b) =>
      a.employeeName.localeCompare(b.employeeName),
    );
    res.json(current.map(serializeEmployeeRate));
  } catch (err) {
    next(err);
  }
});

router.patch("/employee-rates/:id", requireAdmin, async (req, res, next) => {
  try {
    const parsed = UpdateEmployeeRateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid rate update" });
      return;
    }
    const numericId = Number(req.params.id);
    if (!Number.isInteger(numericId)) {
      res.status(404).json({ message: "Rate not found" });
      return;
    }
    const [existing] = await db
      .select()
      .from(employeeRatesTable)
      .where(eq(employeeRatesTable.id, numericId));
    if (!existing) {
      res.status(404).json({ message: "Rate not found" });
      return;
    }
    const body = parsed.data;
    const [row] = await db
      .insert(employeeRatesTable)
      .values({
        employeeId: existing.employeeId,
        employeeName: existing.employeeName,
        employeeRole: existing.employeeRole,
        hourlyRate: body.hourlyRate,
        visitRate: body.visitRate,
        mileageRate: body.mileageRate,
        perDiemRate: body.perDiemRate,
        weekendMultiplier: body.weekendMultiplier,
        holidayMultiplier: body.holidayMultiplier,
        effectiveDate: body.effectiveDate,
      })
      .returning();
    res.json(serializeEmployeeRate(row));
  } catch (err) {
    next(err);
  }
});

router.get("/employee-rates/:id/history", requireAdmin, async (req, res, next) => {
  try {
    await ensureSeeded();
    const numericId = Number(req.params.id);
    if (!Number.isInteger(numericId)) {
      res.status(404).json({ message: "Rate not found" });
      return;
    }
    const [existing] = await db
      .select()
      .from(employeeRatesTable)
      .where(eq(employeeRatesTable.id, numericId));
    if (!existing) {
      res.status(404).json({ message: "Rate not found" });
      return;
    }
    const rows = await db
      .select()
      .from(employeeRatesTable)
      .where(eq(employeeRatesTable.employeeId, existing.employeeId))
      .orderBy(desc(employeeRatesTable.effectiveDate), desc(employeeRatesTable.id));
    res.json(rows.map(serializeEmployeeRate));
  } catch (err) {
    next(err);
  }
});

export default router;
