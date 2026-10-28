import { apiRouter } from "./accounts/routes.js";
import { seedAdmin } from "./accounts/seed.js";
import { AkilimoApiClient } from "./api/client.js";
import { config } from "./config.js";
import { coverageRouter } from "./coverage/routes.js";
import { cropsRouter } from "./crops/routes.js";
import { closeDb, connectDb } from "./db/index.js";
import { DbRegistry, FileRegistry } from "./gateway/registry.js";
import { gatewayRouter } from "./gateway/routes.js";
import { chatRouter } from "./chat/routes.js";
import { ChatSettings } from "./chat/store.js";
import { SecretBox } from "./secrets/crypto.js";
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
    const db = config.database ? await connectDb(config.database) : null;
    console.error(db ? "Accounts enabled (PostgreSQL)" : "Accounts disabled: set DB_HOST, DB_DATABASE, DB_USERNAME and DB_PASSWORD to enable sign-up and saved chats");
    // With a database the MCP server list is a table (filled with the defaults on the first start);
    // without one it is read-only
    const registry = db ? new DbRegistry(db, config.gatewayDataFile, config.port) : new FileRegistry(config.gatewayDataFile, config.port);
    await registry.load();
    console.error(`MCP server list: ${db ? "database table mcp_servers, editable by admin users" : "read-only without accounts"}`);
    if (db && config.adminSeed) console.error(await seedAdmin(db, config.adminSeed));
    console.error(config.secretsKey
      ? "Secrets encryption enabled (SECRETS_KEY)"
      : "SECRETS_KEY not set: provider and MCP server keys cannot be saved; only Ollama works for the chat");

    startHttp(() => createServer(api), {
      port: config.port,
      allowedOrigins: config.allowedOrigins,
      gateway: gatewayRouter(registry, db),
      api: apiRouter(db),
      coverage: coverageRouter(api),
      crops: cropsRouter(api),
      chat: chatRouter(new ChatSettings(db, config.secretsKey ? new SecretBox(config.secretsKey) : null, config.ollamaBaseUrl), registry, db),
    });
  } else {
    await startStdio(createServer(api));
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
