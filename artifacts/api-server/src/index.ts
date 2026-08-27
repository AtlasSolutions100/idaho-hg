import app from "./app";
import { logger } from "./lib/logger";
import {
  hasDemoEmployeeData,
  purgeDemoEmployeeData,
} from "./lib/demo-cleanup";
import { ensureVisitTypesSeeded } from "./lib/visit-types";
import { ensureRosterSeeded } from "./routes/roster";
import { ensureSeeded } from "./routes/rates";
import {
  ensureClerkUserForEmail,
  getConfiguredAdminEmail,
} from "./lib/employee-auth";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Startup migration: permanently remove legacy demo employees (IDs "1"–"6")
// and any data keyed to them, e.g. after a backup restore reintroduced them.
try {
  if (await hasDemoEmployeeData()) {
    await purgeDemoEmployeeData();
    logger.warn(
      "Removed legacy demo employees (IDs 1–6) and their data from the database",
    );
  }
} catch (err) {
  logger.error({ err }, "Failed to purge legacy demo employee data");
  process.exit(1);
}

// Seed the database up front (all idempotent) so the app is fully usable on a
// fresh boot without waiting for a lazy first admin request: the roster
// (clients + employees), their rates (client + employee pay rates), and the
// admin-managed visit-type catalog used by the entry form + write-validation.
try {
  await ensureRosterSeeded();
  await ensureSeeded();
  await ensureVisitTypesSeeded();
} catch (err) {
  logger.error({ err }, "Failed to seed the database on startup");
  process.exit(1);
}

// Make sure the admin (Molly) has a Clerk account, exactly like employees get
// via ensureClerkUserForEmail when they're added to the roster. Without this
// the admin email has no Clerk user, so signing in fails with "we couldn't
// find your account" and there is no in-app way to create one. Creating the
// account grants nothing on its own — signing in still requires the one-time
// code emailed to that address. Best-effort: a Clerk outage must not stop the
// server from booting.
try {
  const adminEmail = getConfiguredAdminEmail();
  if (adminEmail) {
    await ensureClerkUserForEmail(adminEmail);
    logger.info({ adminEmail }, "Admin sign-in account is ready");
  } else {
    logger.warn(
      "ADMIN_EMAIL is not set — nobody can sign in as admin until it is configured",
    );
  }
} catch (err) {
  logger.error(
    { err },
    "Could not prepare the admin Clerk account; admin sign-in may fail until this succeeds",
  );
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
