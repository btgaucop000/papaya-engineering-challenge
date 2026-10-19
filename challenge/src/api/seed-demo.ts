import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { Pool } from "pg";

import { runtimeDatabaseUrl } from "../persistence/index.js";

export const demoClaimIds = Object.freeze([
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
] as const);

const sampleClaims = [
  {
    id: demoClaimIds[0],
    amount: 500,
    policyLimit: 1_000,
    documentType: "claim_form",
  },
  {
    id: demoClaimIds[1],
    amount: 1_000,
    policyLimit: 1_000,
    documentType: "medical_invoice",
  },
  {
    id: demoClaimIds[2],
    amount: 1_500,
    policyLimit: 1_000,
    documentType: "claim_form",
  },
] as const;

export async function seedDemoClaims(connectionString = runtimeDatabaseUrl()): Promise<number> {
  const url = new URL(connectionString);
  const configuredDatabase = url.pathname.slice(1);
  const expectedDatabase = process.env.DEMO_DATABASE_NAME ?? "claims_workflow";
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

  if (configuredDatabase.endsWith("_test")) {
    throw new Error(`Refusing to seed a test database: ${configuredDatabase}`);
  }
  if (configuredDatabase !== expectedDatabase) {
    throw new Error(
      `Refusing to seed database "${configuredDatabase}"; expected DEMO_DATABASE_NAME "${expectedDatabase}"`,
    );
  }
  if (!localHosts.has(url.hostname) && process.env.DEMO_SEED_ALLOW_REMOTE !== "true") {
    throw new Error(
      `Refusing to seed non-local host "${url.hostname}" without DEMO_SEED_ALLOW_REMOTE=true`,
    );
  }

  const pool = new Pool({ connectionString, max: 1 });
  try {
    const databaseResult = await pool.query<{ current_database: string }>(
      "SELECT current_database() AS current_database",
    );
    const actualDatabase = databaseResult.rows[0]?.current_database;
    if (actualDatabase !== expectedDatabase) {
      throw new Error(
        `Connected database "${actualDatabase ?? "unknown"}" does not match "${expectedDatabase}"`,
      );
    }

    let inserted = 0;
    for (const sample of sampleClaims) {
      const result = await pool.query(
        `INSERT INTO claims (id, state, amount, policy_limit, required_documents)
         VALUES (
           $1, 'SUBMITTED', $2, $3,
           jsonb_build_array(jsonb_build_object(
             'type', $4::text,
             'required', true,
             'present', false,
             'valid', false
           ))
         )
         ON CONFLICT (id) DO NOTHING`,
        [sample.id, sample.amount, sample.policyLimit, sample.documentType],
      );
      inserted += result.rowCount ?? 0;
    }
    return inserted;
  } finally {
    await pool.end();
  }
}

const isDirectExecution =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectExecution) {
  const inserted = await seedDemoClaims();
  console.log(`Demo seed complete: ${inserted} inserted, ${sampleClaims.length - inserted} existing.`);
}
