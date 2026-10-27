import { apiRouter } from "./accounts/routes.js";
import { seedAdmin } from "./accounts/seed.js";
import { AkilimoApiClient } from "./api/client.js";
import { config } from "./config.js";
import { closeDb, connectDb } from "./db/index.js";
import { Registry } from "./gateway/registry.js";
import { gatewayRouter } from "./gateway/routes.js";
import { llmRouter } from "./llm/routes.js";
import { createServer } from "./server.js";
import { startHttp } from "./transports/http.js";
import { startStdio } from "./transports/stdio.js";

// `--seed-admin`: ensure the ADMIN_EMAIL account exists as an admin, then exit
async function seedAdminCommand() {
  if (!config.database) throw new Error("--seed-admin needs a database: set DB_HOST, DB_DATABASE, DB_USERNAME and DB_PASSWORD");
  if (!config.adminSeed) throw new Error("--seed-admin needs ADMIN_EMAIL and ADMIN_PASSWORD (ADMIN_NAME is optional)");
  const db = await connectDb(config.database);
  try {
    console.error(await seedAdmin(db, config.adminSeed));
  } finally {
    await closeDb(db);
  }
}

// `--migrate`: apply pending database migrations (connecting does that), then exit
async function migrateCommand() {
  if (!config.database) {
    console.error("No database configured (DB_HOST); nothing to migrate");
    return;
  }
  await closeDb(await connectDb(config.database));
  console.error("Database is up to date");
}

async function main() {
  if (process.argv.includes("--seed-admin")) {
    await seedAdminCommand();
    return;
  }
  if (process.argv.includes("--migrate")) {
    await migrateCommand();
    return;
  }

  const api = new AkilimoApiClient(config.apiBaseUrl, config.apiKey);

  if (config.transport === "http") {
    const registry = new Registry(config.gatewayDataFile, config.port);
    await registry.load();

    const db = config.database ? await connectDb(config.database) : null;
    console.error(db ? "Accounts enabled (PostgreSQL)" : "Accounts disabled: set DB_HOST, DB_DATABASE, DB_USERNAME and DB_PASSWORD to enable sign-up and saved chats");
    console.error(`MCP gateway registry: ${config.gatewayDataFile} (${db ? "editable by admin users" : "read-only without accounts"})`);
    if (db && config.adminSeed) console.error(await seedAdmin(db, config.adminSeed));

    startHttp(() => createServer(api), {
      port: config.port,
      allowedOrigins: config.allowedOrigins,
      gateway: gatewayRouter(registry, db),
      api: apiRouter(db),
      llm: llmRouter(),
    });
  } else {
    await startStdio(createServer(api));
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
