import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serviceRoot = resolve(__dirname, "..");
const migrationsDir = resolve(serviceRoot, "migrations");

function loadEnvFile() {
  const envPath = resolve(serviceRoot, ".env");
  if (!existsSync(envPath)) {
    return;
  }

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://postgres:admin@localhost:5432/e2ee_app";

const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: 1,
});

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function hasMigration(client, version) {
  const result = await client.query("SELECT 1 FROM schema_migrations WHERE version = $1", [
    version,
  ]);
  return result.rowCount > 0;
}

async function run() {
  const client = await pool.connect();

  try {
    await ensureMigrationsTable(client);

    const files = (await readdir(migrationsDir))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const version = file.replace(/\.sql$/, "");

      if (await hasMigration(client, version)) {
        console.log(`Skipping migration ${version}`);
        continue;
      }

      const sql = await readFile(resolve(migrationsDir, file), "utf8");

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
        await client.query("COMMIT");
        console.log(`Applied migration ${version}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
