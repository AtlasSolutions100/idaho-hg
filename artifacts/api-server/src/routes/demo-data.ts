import { Router, type IRouter } from "express";
import { eq, inArray, or, sql, count } from "drizzle-orm";
import {
  db,
  clientsTable,
  employeesTable,
  clientRatesTable,
  employeeRatesTable,
  timeEntriesTable,
  onboardingItemsTable,
} from "@workspace/db";

const router: IRouter = Router();

// Fixed IDs so loading is idempotent and removal is exact.
const DEMO_CLIENT_IDS = ["demo-client-1", "demo-client-2"];
const DEMO_EMPLOYEE_IDS = ["demo-emp-1", "demo-emp-2", "demo-emp-3"];

// Serializes concurrent load/remove requests (see rates.ts backfill lock),
// and time-entry creation against demo records (see time-entries.ts).
export const DEMO_LOCK_KEY = 728394;

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** Date within the current month, clamped so entries never land in the future. */
function monthDay(day: number) {
  const now = new Date();
  const clamped = Math.min(day, now.getDate());
  return iso(new Date(now.getFullYear(), now.getMonth(), clamped));
}

function isWeekend(dateStr: string) {
  const d = new Date(`${dateStr}T12:00:00`);
  return d.getDay() === 0 || d.getDay() === 6;
}

async function status() {
  const [[clients], [employees], [entries]] = await Promise.all([
    db
      .select({ n: count() })
      .from(clientsTable)
      .where(eq(clientsTable.isDemo, true)),
    db
      .select({ n: count() })
      .from(employeesTable)
      .where(eq(employeesTable.isDemo, true)),
    db
      .select({ n: count() })
      .from(timeEntriesTable)
      .where(eq(timeEntriesTable.isDemo, true)),
  ]);
  return {
    loaded: clients.n > 0 || employees.n > 0 || entries.n > 0,
    clientCount: clients.n,
    employeeCount: employees.n,
    entryCount: entries.n,
  };
}

router.get("/demo-data", async (_req, res, next) => {
  try {
    res.json(await status());
  } catch (err) {
    next(err);
  }
});

router.post("/demo-data", async (_req, res, next) => {
  try {
    const effectiveDate = "2020-01-01"; // covers any entry date
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${DEMO_LOCK_KEY})`);

      await tx
        .insert(clientsTable)
        .values([
          { id: "demo-client-1", name: "Demo Clinic", isDemo: true },
          { id: "demo-client-2", name: "Demo Home Health", isDemo: true },
        ])
        .onConflictDoNothing();

      await tx
        .insert(employeesTable)
        .values([
          { id: "demo-emp-1", name: "Demo Nurse Casey", role: "RN", isDemo: true },
          { id: "demo-emp-2", name: "Demo Therapist Jordan", role: "PT", isDemo: true },
          { id: "demo-emp-3", name: "Demo Aide Riley", role: "CNA", isDemo: true },
        ])
        .onConflictDoNothing();

      // Client billing rates: every visit type plus hourly for both clients.
      const clientRates = DEMO_CLIENT_IDS.flatMap((clientId) => {
        const clientName =
          clientId === "demo-client-1" ? "Demo Clinic" : "Demo Home Health";
        return [
          { visitType: "skilled-nursing", rate: 95 },
          { visitType: "physical-therapy", rate: 110 },
          { visitType: "occupational-therapy", rate: 105 },
          { visitType: "speech-therapy", rate: 100 },
          { visitType: "hourly", rate: 68 },
        ].map((r) => ({ clientId, clientName, effectiveDate, ...r }));
      });
      const existingClientRates = await tx
        .select({ clientId: clientRatesTable.clientId })
        .from(clientRatesTable)
        .where(inArray(clientRatesTable.clientId, DEMO_CLIENT_IDS));
      if (existingClientRates.length === 0) {
        await tx.insert(clientRatesTable).values(clientRates);
      }

      const employeeRates = [
        { employeeId: "demo-emp-1", employeeName: "Demo Nurse Casey", employeeRole: "RN", hourlyRate: 48, visitRate: 55 },
        { employeeId: "demo-emp-2", employeeName: "Demo Therapist Jordan", employeeRole: "PT", hourlyRate: 52, visitRate: 60 },
        { employeeId: "demo-emp-3", employeeName: "Demo Aide Riley", employeeRole: "CNA", hourlyRate: 24, visitRate: 30 },
      ].map((e) => ({
        ...e,
        mileageRate: 0.655,
        perDiemRate: 45,
        weekendMultiplier: 1.25,
        holidayMultiplier: 1.5,
        effectiveDate,
      }));
      const existingEmployeeRates = await tx
        .select({ employeeId: employeeRatesTable.employeeId })
        .from(employeeRatesTable)
        .where(inArray(employeeRatesTable.employeeId, DEMO_EMPLOYEE_IDS));
      if (existingEmployeeRates.length === 0) {
        await tx.insert(employeeRatesTable).values(employeeRates);
      }

      const existingEntries = await tx
        .select({ id: timeEntriesTable.id })
        .from(timeEntriesTable)
        .where(eq(timeEntriesTable.isDemo, true))
        .limit(1);
      if (existingEntries.length === 0) {
        const emp1 = { employeeId: "demo-emp-1", employeeName: "Demo Nurse Casey", employeeRole: "RN" };
        const emp2 = { employeeId: "demo-emp-2", employeeName: "Demo Therapist Jordan", employeeRole: "PT" };
        const emp3 = { employeeId: "demo-emp-3", employeeName: "Demo Aide Riley", employeeRole: "CNA" };
        const c1 = { clientId: "demo-client-1", clientName: "Demo Clinic" };
        const c2 = { clientId: "demo-client-2", clientName: "Demo Home Health" };
        const entries = [
          { ...emp1, ...c1, date: monthDay(2), visitType: "skilled-nursing", mileage: 18, note: "Demo visit — wound care" },
          { ...emp1, ...c1, date: monthDay(4), visitType: "skilled-nursing", mileage: 22, perDiem: 1, note: "Demo visit — overnight trip" },
          { ...emp1, ...c2, date: monthDay(6), hours: 6.5, note: "Demo hourly shift" },
          { ...emp2, ...c1, date: monthDay(3), visitType: "physical-therapy", mileage: 12, note: "Demo PT eval" },
          { ...emp2, ...c2, date: monthDay(7), visitType: "physical-therapy", note: "Demo follow-up" },
          { ...emp2, ...c2, date: monthDay(9), visitType: "occupational-therapy", mileage: 8 },
          { ...emp3, ...c2, date: monthDay(5), hours: 8, note: "Demo aide shift" },
          { ...emp3, ...c1, date: monthDay(10), hours: 4.25, mileage: 15 },
          { ...emp3, ...c2, date: monthDay(1), hours: 7, isHoliday: true, note: "Demo holiday coverage" },
        ].map((e, i) => ({
          ...e,
          isWeekend: e.date ? isWeekend(e.date) : false,
          isDemo: true,
          // Mix of statuses so approval and reports both have material.
          status: i % 3 === 0 ? "submitted" : "approved",
          ...(i % 3 === 0 ? {} : { approvedAt: new Date() }),
        }));
        await tx.insert(timeEntriesTable).values(entries);
      }
    });
    res.json(await status());
  } catch (err) {
    next(err);
  }
});

router.delete("/demo-data", async (_req, res, next) => {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${DEMO_LOCK_KEY})`);
      // Remove every entry touching a demo client/employee or tagged demo —
      // covers practice entries users created against demo records too.
      await tx
        .delete(timeEntriesTable)
        .where(
          or(
            eq(timeEntriesTable.isDemo, true),
            inArray(timeEntriesTable.clientId, DEMO_CLIENT_IDS),
            inArray(timeEntriesTable.employeeId, DEMO_EMPLOYEE_IDS),
          ),
        );
      await tx
        .delete(clientRatesTable)
        .where(inArray(clientRatesTable.clientId, DEMO_CLIENT_IDS));
      await tx
        .delete(employeeRatesTable)
        .where(inArray(employeeRatesTable.employeeId, DEMO_EMPLOYEE_IDS));
      await tx
        .delete(onboardingItemsTable)
        .where(inArray(onboardingItemsTable.employeeId, DEMO_EMPLOYEE_IDS));
      await tx.delete(clientsTable).where(eq(clientsTable.isDemo, true));
      await tx.delete(employeesTable).where(eq(employeesTable.isDemo, true));
    });
    res.json(await status());
  } catch (err) {
    next(err);
  }
});

export default router;
