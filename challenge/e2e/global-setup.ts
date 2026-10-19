import { Pool } from "pg";

const ownerUrl =
  process.env.TEST_DATABASE_OWNER_URL ??
  "postgresql://claims_owner:claims_owner@localhost:54329/claims_workflow_test";

export const blockedClaimId = "44444444-4444-4444-8444-444444444444";
export const successClaimId = "55555555-5555-4555-8555-555555555555";

export default async function globalSetup(): Promise<void> {
  const pool = new Pool({ connectionString: ownerUrl, max: 1 });
  try {
    const result = await pool.query<{ current_database: string }>(
      "SELECT current_database() AS current_database",
    );
    const databaseName = result.rows[0]?.current_database ?? "";
    if (!databaseName.endsWith("_test")) {
      throw new Error(`Refusing Playwright setup outside a _test database: ${databaseName}`);
    }

    await pool.query(
      "TRUNCATE TABLE claim_audit, additional_information, payment_requests, claims RESTART IDENTITY CASCADE",
    );
    await pool.query(
      `INSERT INTO claims (id, state, amount, policy_limit, required_documents)
       VALUES
         ($1, 'SUBMITTED', 725, 1000, $3::jsonb),
         ($2, 'SUBMITTED', 500, 1000, $3::jsonb)`,
      [
        blockedClaimId,
        successClaimId,
        JSON.stringify([
          { type: "claim_form", required: true, present: false, valid: false },
        ]),
      ],
    );
  } finally {
    await pool.end();
  }
}
