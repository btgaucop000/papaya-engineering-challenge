import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

import { ownerDatabaseUrl } from "./database-config.js";

const migrationsDirectory = resolve("challenge/db/migrations");

export async function migrateDatabase(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 1 });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
      )
    `);

    const migrationNames = (await readdir(migrationsDirectory))
      .filter((name) => name.endsWith(".sql"))
      .sort();

    for (const name of migrationNames) {
      const alreadyApplied = await pool.query<{ exists: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE name = $1) AS exists",
        [name],
      );
      if (alreadyApplied.rows[0]?.exists === true) {
        continue;
      }

      const sql = await readFile(resolve(migrationsDirectory, name), "utf8");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
}

const isDirectExecution =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectExecution) {
  const useTestDatabase = process.argv.includes("--test");
  await migrateDatabase(ownerDatabaseUrl(useTestDatabase));
  console.log(`Migrations applied to ${useTestDatabase ? "test" : "development"} database.`);
}
