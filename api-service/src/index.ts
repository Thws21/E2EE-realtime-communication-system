import { createApp } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db.js";

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`api-service listening on :${config.port}`);
});

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  server.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
