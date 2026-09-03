import { Router, type IRouter } from "express";
import { eq, inArray, or, sql, count } from "drizzle-orm";
import {
  db,
  clientsTable,
  employeesTable,
  employeeLinkRequestsTable,
  clientRatesTable,
  employeeRatesTable,
  timeEntriesTable,
  onboardingItemsTable,
  feedbackTable,
  qboSentInvoicesTable,
} from "@workspace/db";
import { requireAdmin } from "../lib/employee-auth";

const router: IRouter = Router();

// Fixed IDs so loading is idempotent and removal is exact.
const DEMO_CLIENT_IDS = ["demo-client-1", "demo-client-2"];
const DEMO_EMPLOYEE_IDS = ["demo-emp-1", "demo-emp-2", "demo-emp-3"];
// Clearly-fake sign-in email for one demo employee — no real Clerk account is
// ever created for it; it just makes the Employees page show a linked person.
const DEMO_SIGN_IN_EMAIL = "demo.nurse.casey@practice-demo.example.com";
const DEMO_LINK_REQUEST_EMAIL = "new.hire.demo@practice-demo.example.com";
const DEMO_SENT_INVOICE_ID = "demo-sent-invoice-1";

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

/** Date within the previous month, clamped to that month's length. */
function prevMonthDay(day: number) {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
  const clamped = Math.min(day, lastDay);
  return iso(new Date(now.getFullYear(), now.getMonth() - 1, clamped));
}

/** First/last day of the previous month (the demo invoice's billing period). */
function prevMonthRange() {
  const now = new Date();
  return {
    start: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
    end: iso(new Date(now.getFullYear(), now.getMonth(), 0)),
  };
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

// Admin-only, like the load/remove actions below: the counts are read only by
// Molly's practice-data card, and they disclose how much real data is in the
// system.
router.get("/demo-data", requireAdmin, async (_req, res, next) => {
  try {
    res.json(await status());
  } catch (err) {
    next(err);
  }
});

// Loading demo/practice data seeds fake clients, employees, and entries —
// only Molly (admin) may do it.
router.post("/demo-data", requireAdmin, async (_req, res, next) => {
  try {
    const oldEffectiveDate = "2020-01-01"; // covers any entry date
    // A recent second rate row so the rate-history dialogs have real history.
    const now = new Date();
    const newEffectiveDate = iso(new Date(now.getFullYear(), 0, 1));
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${DEMO_LOCK_KEY})`);

      // Clients come with billing details so invoices and the Clients page
      // look complete.
      await tx
        .insert(clientsTable)
        .values([
          {
            id: "demo-client-1",
            name: "Demo Clinic",
            isDemo: true,
            billingContact: "Accounts Payable — Dana Demo",
            billingAddress: "100 Practice Way, Suite 2\nBoise, ID 83702",
          },
          {
            id: "demo-client-2",
            name: "Demo Home Health",
            isDemo: true,
            billingContact: "Billing Dept — Sam Sample",
            billingAddress: "42 Example Ave\nMeridian, ID 83642",
          },
        ])
        .onConflictDoNothing();

      // Employees with contact details. Casey has a (fake) sign-in email so
      // the Employees page shows a linked person; Jordan has sign-in turned
      // off ("no app access"); Riley is unclaimed — the pending join request
      // below points at them.
      await tx
        .insert(employeesTable)
        .values([
          {
            id: "demo-emp-1",
            name: "Demo Nurse Casey",
            role: "RN",
            isDemo: true,
            email: DEMO_SIGN_IN_EMAIL,
            phone: "(208) 555-0111",
            contactEmail: "casey.demo@example.com",
            address: "11 Sample St, Boise, ID 83702",
          },
          {
            id: "demo-emp-2",
            name: "Demo Therapist Jordan",
            role: "PT",
            isDemo: true,
            signInEnabled: false,
            phone: "(208) 555-0122",
            contactEmail: "jordan.demo@example.com",
            address: "22 Sample Ave, Nampa, ID 83651",
          },
          {
            id: "demo-emp-3",
            name: "Demo Aide Riley",
            role: "CNA",
            isDemo: true,
            phone: "(208) 555-0133",
          },
        ])
        .onConflictDoNothing();

      // A pending "Someone wants to join" request so Molly can practice
      // approving or denying. Riley has no sign-in email, so the claim is
      // valid; approving it just links this fake practice email. If Riley
      // already got linked (a previous request was approved), don't create
      // a new request — a claim on an already-linked profile is invalid.
      const [riley] = await tx
        .select({ email: employeesTable.email })
        .from(employeesTable)
        .where(eq(employeesTable.id, "demo-emp-3"));
      if (riley && riley.email == null) {
        await tx
          .insert(employeeLinkRequestsTable)
          .values({
            id: "demo-link-request-1",
            employeeId: "demo-emp-3",
            email: DEMO_LINK_REQUEST_EMAIL,
          })
          .onConflictDoNothing();
      }

      // Client billing rates: every visit type plus hourly for both clients,
      // with an older and a current rate so history dialogs have entries.
      const clientRates = DEMO_CLIENT_IDS.flatMap((clientId) => {
        const clientName =
          clientId === "demo-client-1" ? "Demo Clinic" : "Demo Home Health";
        return [
          { visitType: "skilled-nursing", oldRate: 90, rate: 95 },
          { visitType: "physical-therapy", oldRate: 105, rate: 110 },
          { visitType: "occupational-therapy", oldRate: 100, rate: 105 },
          { visitType: "speech-therapy", oldRate: 95, rate: 100 },
          { visitType: "hourly", oldRate: 64, rate: 68 },
        ].flatMap((r) => [
          { clientId, clientName, visitType: r.visitType, rate: r.oldRate, effectiveDate: oldEffectiveDate },
          { clientId, clientName, visitType: r.visitType, rate: r.rate, effectiveDate: newEffectiveDate },
        ]);
      });
      const existingClientRates = await tx
        .select({ clientId: clientRatesTable.clientId })
        .from(clientRatesTable)
        .where(inArray(clientRatesTable.clientId, DEMO_CLIENT_IDS));
      if (existingClientRates.length === 0) {
        await tx.insert(clientRatesTable).values(clientRates);
      }

      // Employee pay rates: an older row and a raise this year, so the pay
      // rate history dialog shows real history.
      const employeeRateBase = [
        { employeeId: "demo-emp-1", employeeName: "Demo Nurse Casey", employeeRole: "RN", oldHourly: 45, hourlyRate: 48, oldVisit: 52, visitRate: 55 },
        { employeeId: "demo-emp-2", employeeName: "Demo Therapist Jordan", employeeRole: "PT", oldHourly: 50, hourlyRate: 52, oldVisit: 58, visitRate: 60 },
        { employeeId: "demo-emp-3", employeeName: "Demo Aide Riley", employeeRole: "CNA", oldHourly: 22, hourlyRate: 24, oldVisit: 28, visitRate: 30 },
      ];
      const shared = {
        mileageRate: 0.655,
        perDiemRate: 45,
        weekendMultiplier: 1.25,
        holidayMultiplier: 1.5,
      };
      const employeeRates = employeeRateBase.flatMap((e) => [
        {
          employeeId: e.employeeId,
          employeeName: e.employeeName,
          employeeRole: e.employeeRole,
          hourlyRate: e.oldHourly,
          visitRate: e.oldVisit,
          ...shared,
          effectiveDate: oldEffectiveDate,
        },
        {
          employeeId: e.employeeId,
          employeeName: e.employeeName,
          employeeRole: e.employeeRole,
          hourlyRate: e.hourlyRate,
          visitRate: e.visitRate,
          ...shared,
          effectiveDate: newEffectiveDate,
        },
      ]);
      const existingEmployeeRates = await tx
        .select({ employeeId: employeeRatesTable.employeeId })
        .from(employeeRatesTable)
        .where(inArray(employeeRatesTable.employeeId, DEMO_EMPLOYEE_IDS));
      if (existingEmployeeRates.length === 0) {
        await tx.insert(employeeRatesTable).values(employeeRates);
      }

      // Onboarding checklist progress for the newest demo hire.
      const existingOnboarding = await tx
        .select({ id: onboardingItemsTable.id })
        .from(onboardingItemsTable)
        .where(inArray(onboardingItemsTable.employeeId, DEMO_EMPLOYEE_IDS))
        .limit(1);
      if (existingOnboarding.length === 0) {
        await tx.insert(onboardingItemsTable).values([
          { employeeId: "demo-emp-3", itemKey: "background-check", completed: true, completedAt: new Date() },
          { employeeId: "demo-emp-3", itemKey: "drug-test", completed: true, completedAt: new Date() },
          { employeeId: "demo-emp-3", itemKey: "payroll-packet", completed: false },
        ]);
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

        // A fully completed prior month (all approved) so reports, invoices,
        // and reconciliation have a finished period to work with.
        const priorMonth = [
          { ...emp1, ...c1, date: prevMonthDay(2), visitType: "skilled-nursing", mileage: 16, note: "Demo visit — admission" },
          { ...emp1, ...c1, date: prevMonthDay(6), visitType: "skilled-nursing", mileage: 20, perDiem: 1, note: "Demo visit — overnight trip" },
          { ...emp1, ...c1, date: prevMonthDay(13), visitType: "skilled-nursing", mileage: 18, note: "Demo visit — wound care" },
          { ...emp1, ...c2, date: prevMonthDay(9), hours: 6, note: "Demo hourly shift" },
          { ...emp1, ...c2, date: prevMonthDay(21), hours: 7.5, mileage: 25 },
          { ...emp2, ...c1, date: prevMonthDay(3), visitType: "physical-therapy", mileage: 12, note: "Demo PT eval" },
          { ...emp2, ...c1, date: prevMonthDay(10), visitType: "physical-therapy", note: "Demo follow-up" },
          { ...emp2, ...c2, date: prevMonthDay(15), visitType: "occupational-therapy", mileage: 8 },
          { ...emp2, ...c2, date: prevMonthDay(24), visitType: "speech-therapy", mileage: 10, note: "Demo ST consult" },
          { ...emp3, ...c2, date: prevMonthDay(4), hours: 8, note: "Demo aide shift" },
          { ...emp3, ...c1, date: prevMonthDay(11), hours: 4.25, mileage: 15 },
          { ...emp3, ...c2, date: prevMonthDay(18), hours: 7, isHoliday: true, note: "Demo holiday coverage" },
          { ...emp3, ...c2, date: prevMonthDay(27), hours: 6.5, perDiem: 1, note: "Demo overnight stay" },
        ].map((e) => ({
          ...e,
          isWeekend: isWeekend(e.date),
          isDemo: true,
          status: "approved",
          approvedAt: new Date(),
        }));

        // The current month mixes submitted and approved entries so the
        // payroll-approval screen has work to practice on.
        const currentMonth = [
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
          isWeekend: isWeekend(e.date),
          isDemo: true,
          // Mix of statuses so approval and reports both have material.
          status: i % 3 === 0 ? "submitted" : "approved",
          ...(i % 3 === 0 ? {} : { approvedAt: new Date() }),
        }));

        await tx.insert(timeEntriesTable).values([...priorMonth, ...currentMonth]);
      }

      // A recorded practice "sent invoice" for the prior month, so the
      // invoice screen shows what a sent invoice looks like. Local record
      // only — nothing is ever sent to QuickBooks.
      const { start, end } = prevMonthRange();
      await tx
        .insert(qboSentInvoicesTable)
        .values({
          id: DEMO_SENT_INVOICE_ID,
          clientId: "demo-client-1",
          periodStart: start,
          periodEnd: end,
          qboInvoiceId: "demo-practice-invoice",
          docNumber: "DEMO-1001",
          isDemo: true,
        })
        .onConflictDoNothing();

      // A couple of sample feedback messages so that screen isn't empty.
      const existingFeedback = await tx
        .select({ id: feedbackTable.id })
        .from(feedbackTable)
        .where(eq(feedbackTable.isDemo, true))
        .limit(1);
      if (existingFeedback.length === 0) {
        await tx.insert(feedbackTable).values([
          {
            type: "idea",
            message: "Sample feedback: it would be nice to see my mileage total for the week. (Practice message — remove demo data to clear.)",
            name: "Demo Nurse Casey",
            page: "/employee",
            isDemo: true,
          },
          {
            type: "problem",
            message: "Sample feedback: I couldn't find where to change my phone number. (Practice message — remove demo data to clear.)",
            name: "Demo Aide Riley",
            page: "/employee",
            isDemo: true,
          },
        ]);
      }
    });
    res.json(await status());
  } catch (err) {
    next(err);
  }
});

// Wiping demo data is destructive (deletes rows across many tables) —
// admin only.
router.delete("/demo-data", requireAdmin, async (_req, res, next) => {
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
      await tx
        .delete(employeeLinkRequestsTable)
        .where(inArray(employeeLinkRequestsTable.employeeId, DEMO_EMPLOYEE_IDS));
      await tx
        .delete(qboSentInvoicesTable)
        .where(
          or(
            eq(qboSentInvoicesTable.isDemo, true),
            inArray(qboSentInvoicesTable.clientId, DEMO_CLIENT_IDS),
          ),
        );
      await tx.delete(feedbackTable).where(eq(feedbackTable.isDemo, true));
      await tx.delete(clientsTable).where(eq(clientsTable.isDemo, true));
      await tx.delete(employeesTable).where(eq(employeesTable.isDemo, true));
    });
    res.json(await status());
  } catch (err) {
    next(err);
  }
});

export default router;
