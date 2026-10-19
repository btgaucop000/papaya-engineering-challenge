import { Pool } from "pg";

const ownerUrl =
  process.env.TEST_DATABASE_OWNER_URL ??
  "postgresql://claims_owner:claims_owner@localhost:54329/claims_workflow_test";

export const extensionClaimId = "66666666-6666-4666-8666-666666666666";

export default async function globalSetup(): Promise<void> {
  const pool = new Pool({ connectionString: ownerUrl, max: 1 });
  try {
    const result = await pool.query<{ current_database: string }>(
      "SELECT current_database() AS current_database",
    );
    const databaseName = result.rows[0]?.current_database ?? "";
    if (!databaseName.endsWith("_test")) {
      throw new Error(`Refusing extension setup outside a _test database: ${databaseName}`);
    }

    await pool.query(
      "TRUNCATE TABLE claim_audit, additional_information, payment_requests, claims RESTART IDENTITY CASCADE",
    );
    await pool.query(
      `INSERT INTO claims (
         id, state, amount, policy_limit, required_documents, assessor_id,
         assessment_report, assessment_report_complete
       ) VALUES ($1, 'UNDER_ASSESSMENT', 500, 1000, '[]'::jsonb,
                 'demo-assessor', '{"summary":"Ready for manual review"}'::jsonb, true)`,
      [extensionClaimId],
    );
  } finally {
    await pool.end();
  }
}
