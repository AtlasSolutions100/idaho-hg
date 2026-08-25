// Vitest globalSetup: seed the shared test database ONCE before any e2e file
// runs. The e2e files share a single database and several depend on the
// standard roster + rate seed being present; the app's lazy seeding is
// order-fragile on a fresh DB (a test's POST /employees can make rate seeding
// skip permanently). Seeding here up front removes that race. Idempotent — on
// an already-seeded DB (e.g. a persistent CI DB) the seed functions no-op.
export default async function seedTestDatabase() {
  if (!process.env.DATABASE_URL) return; // no DB configured — nothing to seed

  const { ensureRosterSeeded } = await import("../routes/roster");
  const { ensureSeeded } = await import("../routes/rates");
  const { ensureVisitTypesSeeded } = await import("../lib/visit-types");

  // Roster (clients + employees) first, then rates (client + employee rates),
  // then the visit-type catalog used by entry validation.
  await ensureRosterSeeded();
  await ensureSeeded();
  await ensureVisitTypesSeeded();
}
