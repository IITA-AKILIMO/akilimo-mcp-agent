import { AkilimoApiClient } from "./api/client.js";
import { config } from "./config.js";
import { createServer } from "./server.js";
import { startHttp } from "./transports/http.js";
import { startStdio } from "./transports/stdio.js";

async function main() {
  const api = new AkilimoApiClient(config.apiBaseUrl, config.apiKey);

  if (config.transport === "http") {
    startHttp(() => createServer(api), { port: config.port, allowedOrigins: config.allowedOrigins });
  } else {
    await startStdio(createServer(api));
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
