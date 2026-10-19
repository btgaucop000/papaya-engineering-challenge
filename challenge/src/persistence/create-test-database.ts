import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { Client } from "pg";

import { defaultDatabaseUrls, ownerDatabaseUrl } from "./database-config.js";

export async function createTestDatabase(): Promise<string> {
  const testUrl = new URL(ownerDatabaseUrl(true));
  const databaseName = testUrl.pathname.slice(1);
  if (!/^[a-z][a-z0-9_]*_test$/.test(databaseName)) {
    throw new Error(`Refusing to create a database without the _test suffix: ${databaseName}`);
  }

  const admin = new Client({
    connectionString: process.env.POSTGRES_ADMIN_URL ?? defaultDatabaseUrls.admin,
  });
  await admin.connect();
  try {
    const existing = await admin.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists",
      [databaseName],
    );
    if (existing.rows[0]?.exists !== true) {
      await admin.query(`CREATE DATABASE "${databaseName}"`);
    }
  } finally {
    await admin.end();
  }
  return databaseName;
}

const isDirectExecution =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectExecution) {
  const databaseName = await createTestDatabase();
  console.log(`Test database ready: ${databaseName}`);
}
