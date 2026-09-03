import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, disciplinesTable } from "@workspace/db";
import { CreateDisciplineBody, UpdateDisciplineBody } from "@workspace/api-zod";
import { requireAdmin } from "../lib/employee-auth";
import {
  ensureDisciplinesSeeded,
  listDisciplineRows,
  normalizeDisciplineKey,
  serializeDiscipline,
} from "../lib/disciplines";

const router: IRouter = Router();

// Public, like GET /clients and GET /visit-types: the catalog is a list of
// profession labels, nothing sensitive, and someone claiming a roster profile
// has to pick their discipline before they have a linked session. Writes are
// admin-only.
router.get("/disciplines", async (_req, res, next) => {
  try {
    const rows = await listDisciplineRows();
    res.json(rows.map(serializeDiscipline));
  } catch (err) {
    next(err);
  }
});

router.post("/disciplines", requireAdmin, async (req, res, next) => {
  try {
    await ensureDisciplinesSeeded();
    const parsed = CreateDisciplineBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid discipline" });
      return;
    }
    const label = parsed.data.label.trim();
    if (!label) {
      res.status(400).json({ message: "A name is required." });
      return;
    }
    const key = normalizeDisciplineKey(parsed.data.key?.trim() || label);
    if (!key) {
      res.status(400).json({ message: "Could not derive a key from the name; provide one." });
      return;
    }
    const [existing] = await db
      .select()
      .from(disciplinesTable)
      .where(eq(disciplinesTable.key, key));
    if (existing) {
      res.status(409).json({ message: `A discipline "${key}" already exists.` });
      return;
    }
    const all = await db.select().from(disciplinesTable);
    const maxSort = all.reduce((m, r) => Math.max(m, r.sortOrder), 0);
    const sortOrder =
      parsed.data.sortOrder != null ? Math.round(parsed.data.sortOrder) : maxSort + 10;
    const [row] = await db
      .insert(disciplinesTable)
      .values({ key, label, sortOrder })
      .returning();
    res.status(201).json(serializeDiscipline(row!));
  } catch (err) {
    next(err);
  }
});

router.patch("/disciplines/:key", requireAdmin, async (req, res, next) => {
  try {
    const key = String(req.params.key);
    const parsed = UpdateDisciplineBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid update" });
      return;
    }
    const [existing] = await db
      .select()
      .from(disciplinesTable)
      .where(eq(disciplinesTable.key, key));
    if (!existing) {
      res.status(404).json({ message: "Discipline not found" });
      return;
    }
    // The key is never editable: it is the rate-lookup value already stamped
    // on employees.role, time_entries.employee_role and every rate row that
    // references it. Renaming it would orphan all of them silently.
    const update: Partial<typeof disciplinesTable.$inferInsert> = {};
    if (parsed.data.label != null) update.label = parsed.data.label.trim();
    if (parsed.data.active != null) update.active = parsed.data.active;
    if (parsed.data.sortOrder != null) update.sortOrder = Math.round(parsed.data.sortOrder);
    const [row] = await db
      .update(disciplinesTable)
      .set(update)
      .where(eq(disciplinesTable.key, key))
      .returning();
    res.json(serializeDiscipline(row!));
  } catch (err) {
    next(err);
  }
});

export default router;
