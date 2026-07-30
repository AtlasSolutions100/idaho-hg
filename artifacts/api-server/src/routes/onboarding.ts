import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import {
  db,
  employeesTable,
  onboardingItemsTable,
  type OnboardingItemRow,
} from "@workspace/db";
import { UpdateOnboardingItemBody } from "@workspace/api-zod";
import { ensureRosterSeeded } from "./roster";

const router: IRouter = Router();

// Molly's real "New Employee checklist prior to working". Checklist only —
// this app never stores the documents themselves, just whether each item
// is done.
export const ONBOARDING_ITEMS: Array<{
  key: string;
  label: string;
  note?: string;
}> = [
  { key: "background-check", label: "Background check" },
  { key: "drug-test", label: "Drug test" },
  {
    key: "id-license-documents",
    label:
      "Copy of professional license, driver's license, passport or second form of ID (for I-9), CPR/BLS, Resume for clients",
  },
  {
    key: "auto-insurance",
    label: "Copy of Auto insurance",
    note: "Only if home health",
  },
  { key: "vaccinations", label: "Copy of vaccinations / exemptions" },
  {
    key: "occupational-health",
    label:
      "Complete all pre-hire occupational health requirements (TB test, fit test)",
  },
  { key: "payroll-packet", label: "Complete Payroll packet" },
  { key: "code-of-conduct", label: "Sign Code of Conduct" },
];

const itemByKey = new Map(ONBOARDING_ITEMS.map((item) => [item.key, item]));

function serialize(
  def: { key: string; label: string; note?: string },
  row: OnboardingItemRow | undefined,
) {
  return {
    itemKey: def.key,
    label: def.label,
    ...(def.note ? { note: def.note } : {}),
    completed: row?.completed ?? false,
    ...(row?.completedAt ? { completedAt: row.completedAt.toISOString() } : {}),
  };
}

async function findEmployee(id: string) {
  await ensureRosterSeeded();
  const [employee] = await db
    .select()
    .from(employeesTable)
    .where(eq(employeesTable.id, id));
  return employee;
}

router.get("/employees/:id/onboarding", async (req, res, next) => {
  try {
    const employee = await findEmployee(req.params.id);
    if (!employee) {
      res.status(404).json({ message: "Employee not found" });
      return;
    }
    const rows = await db
      .select()
      .from(onboardingItemsTable)
      .where(eq(onboardingItemsTable.employeeId, employee.id));
    const rowByKey = new Map(rows.map((row) => [row.itemKey, row]));
    res.json(
      ONBOARDING_ITEMS.map((def) => serialize(def, rowByKey.get(def.key))),
    );
  } catch (err) {
    next(err);
  }
});

router.patch("/employees/:id/onboarding/:itemKey", async (req, res, next) => {
  try {
    const parsed = UpdateOnboardingItemBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: parsed.error.issues[0]?.message ?? "Invalid update",
      });
      return;
    }
    const employee = await findEmployee(req.params.id);
    if (!employee) {
      res.status(404).json({ message: "Employee not found" });
      return;
    }
    const def = itemByKey.get(req.params.itemKey);
    if (!def) {
      res.status(404).json({ message: "Checklist item not found" });
      return;
    }
    const completed = parsed.data.completed;
    const completedAt = completed ? new Date() : null;
    const [row] = await db
      .insert(onboardingItemsTable)
      .values({
        employeeId: employee.id,
        itemKey: def.key,
        completed,
        completedAt,
      })
      .onConflictDoUpdate({
        target: [onboardingItemsTable.employeeId, onboardingItemsTable.itemKey],
        set: { completed, completedAt },
      })
      .returning();
    res.json(serialize(def, row));
  } catch (err) {
    next(err);
  }
});

export default router;
