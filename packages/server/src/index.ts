import { apiRouter } from "./accounts/routes.js";
import { AkilimoApiClient } from "./api/client.js";
import { config } from "./config.js";
import { connectDb } from "./db/index.js";
import { Registry } from "./gateway/registry.js";
import { gatewayRouter } from "./gateway/routes.js";
import { createServer } from "./server.js";
import { startHttp } from "./transports/http.js";
import { startStdio } from "./transports/stdio.js";

async function main() {
  const api = new AkilimoApiClient(config.apiBaseUrl, config.apiKey);

  if (config.transport === "http") {
    const registry = new Registry(config.gatewayDataFile, config.port);
    await registry.load();
    console.error(`MCP gateway registry: ${config.gatewayDataFile} (${config.gatewayAdminToken ? "editable with admin token" : "read-only, set GATEWAY_ADMIN_TOKEN to edit"})`);

    const db = config.database ? await connectDb(config.database) : null;
    console.error(db ? `Accounts enabled (${config.database!.connection})` : "Accounts disabled: set DB_CONNECTION (pgsql or sqlite) and DB_* to enable sign-up and saved chats");

    startHttp(() => createServer(api), {
      port: config.port,
      allowedOrigins: config.allowedOrigins,
      gateway: gatewayRouter(registry, config.gatewayAdminToken),
      api: apiRouter(db),
    });
  } else {
    await startStdio(createServer(api));
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
