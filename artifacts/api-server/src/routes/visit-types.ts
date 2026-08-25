import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import {
  db,
  visitTypesTable,
  visitPayRatesTable,
  type VisitPayRateRow,
} from "@workspace/db";
import {
  CreateVisitTypeBody,
  UpdateVisitTypeBody,
  CreateVisitPayRateBody,
  UpdateVisitPayRateBody,
} from "@workspace/api-zod";
import { requireAdmin, requireSignedIn } from "../lib/employee-auth";
import {
  ensureVisitTypesSeeded,
  listVisitTypeRows,
  getVisitTypeKeySet,
  slugifyVisitTypeKey,
  serializeVisitType,
} from "../lib/visit-types";

const router: IRouter = Router();

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function serializeVisitPayRate(row: VisitPayRateRow) {
  return {
    id: String(row.id),
    discipline: row.discipline,
    visitType: row.visitType,
    rate: row.rate,
    effectiveDate: row.effectiveDate,
  };
}

// Latest history row per (discipline, visitType): the currently-effective rate.
function currentPayRates(rows: VisitPayRateRow[]): VisitPayRateRow[] {
  const latest = new Map<string, VisitPayRateRow>();
  for (const row of rows) {
    const key = `${row.discipline}::${row.visitType}`;
    const existing = latest.get(key);
    const isNewer =
      !existing ||
      row.effectiveDate > existing.effectiveDate ||
      (row.effectiveDate === existing.effectiveDate && row.id > existing.id);
    if (isNewer) latest.set(key, row);
  }
  return [...latest.values()];
}

// ---------------------------------------------------------------------------
// Visit-type catalog (admin-managed). Readable by any signed-in user so the
// employee log-hours form can populate its checklist; writes are admin-only.
// ---------------------------------------------------------------------------

router.get("/visit-types", requireSignedIn, async (_req, res, next) => {
  try {
    const rows = await listVisitTypeRows();
    res.json(rows.map(serializeVisitType));
  } catch (err) {
    next(err);
  }
});

router.post("/visit-types", requireAdmin, async (req, res, next) => {
  try {
    await ensureVisitTypesSeeded();
    const parsed = CreateVisitTypeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid visit type" });
      return;
    }
    const { label, abbreviation } = parsed.data;
    const key = (parsed.data.key?.trim() || slugifyVisitTypeKey(label)).toLowerCase();
    if (!key) {
      res.status(400).json({ message: "Could not derive a key from the label; provide one." });
      return;
    }
    const [existing] = await db
      .select()
      .from(visitTypesTable)
      .where(eq(visitTypesTable.key, key));
    if (existing) {
      res.status(409).json({ message: `A visit type "${key}" already exists.` });
      return;
    }
    const all = await db.select().from(visitTypesTable);
    const maxSort = all.reduce((m, r) => Math.max(m, r.sortOrder), 0);
    const sortOrder =
      parsed.data.sortOrder != null ? Math.round(parsed.data.sortOrder) : maxSort + 10;
    const [row] = await db
      .insert(visitTypesTable)
      .values({ key, label: label.trim(), abbreviation: abbreviation.trim(), sortOrder })
      .returning();
    res.status(201).json(serializeVisitType(row!));
  } catch (err) {
    next(err);
  }
});

router.patch("/visit-types/:key", requireAdmin, async (req, res, next) => {
  try {
    const key = String(req.params.key);
    const parsed = UpdateVisitTypeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid update" });
      return;
    }
    const [existing] = await db
      .select()
      .from(visitTypesTable)
      .where(eq(visitTypesTable.key, key));
    if (!existing) {
      res.status(404).json({ message: "Visit type not found" });
      return;
    }
    const update: Partial<typeof visitTypesTable.$inferInsert> = {};
    if (parsed.data.label != null) update.label = parsed.data.label.trim();
    if (parsed.data.abbreviation != null) update.abbreviation = parsed.data.abbreviation.trim();
    if (parsed.data.active != null) update.active = parsed.data.active;
    if (parsed.data.sortOrder != null) update.sortOrder = Math.round(parsed.data.sortOrder);
    const [row] = await db
      .update(visitTypesTable)
      .set(update)
      .where(eq(visitTypesTable.key, key))
      .returning();
    res.json(serializeVisitType(row!));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Per-discipline visit PAY rates (the pay matrix). Admin-only — pay data.
// Append-only history, exactly like client_rates.
// ---------------------------------------------------------------------------

router.get("/visit-pay-rates", requireAdmin, async (_req, res, next) => {
  try {
    const rows = await db.select().from(visitPayRatesTable);
    const current = currentPayRates(rows).sort(
      (a, b) =>
        a.visitType.localeCompare(b.visitType) || a.discipline.localeCompare(b.discipline),
    );
    res.json(current.map(serializeVisitPayRate));
  } catch (err) {
    next(err);
  }
});

router.post("/visit-pay-rates", requireAdmin, async (req, res, next) => {
  try {
    const parsed = CreateVisitPayRateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid pay rate" });
      return;
    }
    const discipline = parsed.data.discipline.trim();
    const visitType = parsed.data.visitType;
    if (!discipline) {
      res.status(400).json({ message: "Discipline is required." });
      return;
    }
    const validKeys = await getVisitTypeKeySet();
    if (!validKeys.has(visitType)) {
      res.status(400).json({ message: `Unknown visit type "${visitType}".` });
      return;
    }
    if (!(parsed.data.rate >= 0)) {
      res.status(400).json({ message: "Rate must be zero or greater." });
      return;
    }
    const effectiveDate = parsed.data.effectiveDate?.trim() || todayIso();
    const [row] = await db
      .insert(visitPayRatesTable)
      .values({ discipline, visitType, rate: parsed.data.rate, effectiveDate })
      .returning();
    res.status(201).json(serializeVisitPayRate(row!));
  } catch (err) {
    next(err);
  }
});

router.patch("/visit-pay-rates/:id", requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ message: "Invalid id" });
      return;
    }
    const parsed = UpdateVisitPayRateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid update" });
      return;
    }
    if (!(parsed.data.rate >= 0)) {
      res.status(400).json({ message: "Rate must be zero or greater." });
      return;
    }
    const [existing] = await db
      .select()
      .from(visitPayRatesTable)
      .where(eq(visitPayRatesTable.id, id));
    if (!existing) {
      res.status(404).json({ message: "Visit pay rate not found" });
      return;
    }
    // Append-only: a change inserts a new history row for the same
    // (discipline, visitType) rather than overwriting the old rate.
    const effectiveDate = parsed.data.effectiveDate?.trim() || todayIso();
    const [row] = await db
      .insert(visitPayRatesTable)
      .values({
        discipline: existing.discipline,
        visitType: existing.visitType,
        rate: parsed.data.rate,
        effectiveDate,
      })
      .returning();
    res.json(serializeVisitPayRate(row!));
  } catch (err) {
    next(err);
  }
});

export default router;
