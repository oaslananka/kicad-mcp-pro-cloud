import { loadConfig } from "./config.js";
import { createVerifier } from "./auth.js";
import { createHttpServer } from "./http.js";
import { PgGrantManagement } from "./grants.js";

const config = loadConfig();
const inventory = new PgGrantManagement(config.databaseUrl);
const server = createHttpServer(config, inventory, createVerifier(config), inventory);
server.listen(config.port, config.host, () => {
  // Never log credential-bearing URLs, project data or request bodies.
  process.stdout.write("Cloud MCP server listening on configured interface\n");
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => { void inventory.close().finally(() => process.exit(0)); });
  });
}
