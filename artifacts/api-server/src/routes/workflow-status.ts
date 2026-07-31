import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, workflowStatusTable } from "@workspace/db";

const router: IRouter = Router();

// Period keys are the Monday of the week, YYYY-MM-DD.
function validPeriod(period: unknown): period is string {
  if (typeof period !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(period)) {
    return false;
  }
  const d = new Date(`${period}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== period) {
    return false;
  }
  return d.getUTCDay() === 1; // Monday
}

const PERIOD_ERROR = { message: "period must be a Monday in YYYY-MM-DD form" };

router.get("/workflow-status", async (req, res) => {
  const period = req.query.period;
  if (!validPeriod(period)) {
    return res.status(400).json(PERIOD_ERROR);
  }
  const [row] = await db
    .select()
    .from(workflowStatusTable)
    .where(eq(workflowStatusTable.period, period));
  return res.json({
    period,
    exportDone: row?.exportDone ?? false,
    invoicesDone: row?.invoicesDone ?? false,
  });
});

// Partial update: only the flags present in the body change; the other keeps
// its stored value. This avoids lost updates when both boxes are toggled in
// quick succession.
router.put("/workflow-status", async (req, res) => {
  const { period, exportDone, invoicesDone } = req.body ?? {};
  if (!validPeriod(period)) {
    return res.status(400).json(PERIOD_ERROR);
  }
  for (const [name, value] of [
    ["exportDone", exportDone],
    ["invoicesDone", invoicesDone],
  ] as const) {
    if (value !== undefined && typeof value !== "boolean") {
      return res.status(400).json({ message: `${name} must be a boolean` });
    }
  }

  const [row] = await db
    .insert(workflowStatusTable)
    .values({
      period,
      exportDone: exportDone ?? false,
      invoicesDone: invoicesDone ?? false,
    })
    .onConflictDoUpdate({
      target: workflowStatusTable.period,
      set: {
        // COALESCE against excluded values so omitted flags keep the stored value.
        ...(exportDone !== undefined ? { exportDone } : {}),
        ...(invoicesDone !== undefined ? { invoicesDone } : {}),
        updatedAt: sql`now()`,
      },
    })
    .returning();
  return res.json({
    period: row.period,
    exportDone: row.exportDone,
    invoicesDone: row.invoicesDone,
  });
});

export default router;
