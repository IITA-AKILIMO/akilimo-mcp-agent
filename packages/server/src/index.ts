import { apiRouter } from "./accounts/routes.js";
import { seedAdmin } from "./accounts/seed.js";
import { AkilimoApiClient } from "./api/client.js";
import { akilimoKeyVerifier } from "./api/keys.js";
import { config } from "./config.js";
import { coverageRouter } from "./coverage/routes.js";
import { countriesRouter } from "./countries/routes.js";
import { cropsRouter } from "./crops/routes.js";
import { closeDb, connectDb } from "./db/index.js";
import { DbRegistry, FileRegistry } from "./gateway/registry.js";
import { CallQuota } from "./gateway/quota.js";
import { ClientKeyStore } from "./mcpkeys/store.js";
import { gatewayRouter } from "./gateway/routes.js";
import { chatRouter } from "./chat/routes.js";
import { ChatSettings } from "./chat/store.js";
import { SecretBox } from "./secrets/crypto.js";
import { createServer } from "./server.js";
import { anyKeyVerifier, staticKeyVerifier } from "./transports/guards.js";
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

    // MCP clients get in with an operator key (MCP_API_KEYS) or an MCP key users create in the
    // Akilimo API's playground, checked by the API with this server's AKILIMO_API_KEY
    // A key is always required (only the server's own loopback calls are exempt)
    // Keys admins issue in the database (Manage > MCP keys), operator keys from MCP_API_KEYS, and the ak_ keys
    // users create in the Akilimo API playground are all accepted
    const clientKeys = db ? new ClientKeyStore(db) : null;
    const verifyKey = anyKeyVerifier([
      staticKeyVerifier(config.mcpApiKeys),
      ...(clientKeys ? [clientKeys.verifier()] : []),
      ...(config.apiKey ? [akilimoKeyVerifier(api)] : []),
    ]);
    if (!config.apiKey) console.error("AKILIMO_API_KEY not set: MCP keys created in the Akilimo API (ak_...) cannot be checked");
    console.error(config.mcpApiKeys.length === 0 && !config.apiKey
      ? "MCP endpoints need an API key and none can be accepted: set MCP_API_KEYS or AKILIMO_API_KEY, otherwise only the web UI and chat of this server can use them"
      : "MCP endpoints need an API key");

    // The keys admins saved for upstream servers are shared with signed-in users, within a per-user limit
    const chatSettings = new ChatSettings(db, config.secretsKey ? new SecretBox(config.secretsKey) : null, config.ollamaBaseUrl);
    const sharedKeyQuota = new CallQuota({ perMinute: config.sharedKeyPerMinute, perDay: config.sharedKeyPerDay });

    startHttp(() => createServer(api), {
      port: config.port,
      allowedOrigins: config.allowedOrigins,
      access: { verifyKey, keyQuota: new CallQuota({ perMinute: config.clientKeyPerMinute, perDay: config.clientKeyPerDay }) },
      limits: {
        requestsPerMinute: config.mcpRateLimit,
        computePerMinute: config.mcpComputeRateLimit,
        sseSessions: config.sseMaxSessions,
        sseSessionsPerIp: config.sseMaxSessionsPerIp,
      },
      gateway: gatewayRouter(registry, db, chatSettings, sharedKeyQuota),
      api: apiRouter(db, clientKeys),
      coverage: coverageRouter(api),
      crops: cropsRouter(api),
      countries: countriesRouter(api),
      chat: chatRouter(chatSettings, registry, db, api, sharedKeyQuota),
    });
  } else {
    await startStdio(createServer(api));
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
