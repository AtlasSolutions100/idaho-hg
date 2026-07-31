import app from "./app";
import { logger } from "./lib/logger";
import {
  hasDemoEmployeeData,
  purgeDemoEmployeeData,
} from "./lib/demo-cleanup";

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

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
