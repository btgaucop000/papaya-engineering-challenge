import type { Pool, PoolClient, QueryResultRow } from "pg";

import type {
  AuditRecord,
  ClaimRecord,
  CreateClaimInput,
  PaymentRequestRecord,
  RequiredDocument,
} from "./types.js";

type DatabaseExecutor = Pool | PoolClient;

type ClaimRow = QueryResultRow & {
  id: string;
  state: string;
  amount: string;
  policy_limit: string;
  required_documents: RequiredDocument[];
  assessor_id: string | null;
  assessment_report: Record<string, unknown> | null;
  assessment_report_complete: boolean;
  assessment_started_at: Date | null;
  information_request_count: number;
  current_information_request_sequence: number | null;
  current_information_request_description: string | null;
  rejection_reason: string | null;
  appeal_expires_at: Date | null;
  member_acknowledged_rejection: boolean;
  archived_at: Date | null;
  audit_sequence: number;
};

type PaymentRequestRow = QueryResultRow & {
  id: string;
  claim_id: string;
  amount: string;
  status: "REQUESTED" | "INITIATED";
  confirmed: boolean;
  payment_reference: string | null;
};

type AuditRow = QueryResultRow & {
  claim_id: string;
  sequence: number;
  occurred_at: Date;
  from_state: string;
  to_state: string;
  transition_id: string;
  triggered_by_user_id: string;
  triggered_by_role: string;
  reason: string | null;
};

const claimColumns = `
  id, state, amount, policy_limit, required_documents, assessor_id,
  assessment_report, assessment_report_complete, assessment_started_at,
  information_request_count, current_information_request_sequence,
  current_information_request_description, rejection_reason, appeal_expires_at,
  member_acknowledged_rejection, archived_at, audit_sequence
`;

function mapClaim(row: ClaimRow): ClaimRecord {
  return {
    id: row.id,
    state: row.state,
    amount: Number(row.amount),
    policyLimit: Number(row.policy_limit),
    requiredDocuments: row.required_documents,
    assessorId: row.assessor_id,
    assessmentReport: row.assessment_report,
    assessmentReportComplete: row.assessment_report_complete,
    assessmentStartedAt: row.assessment_started_at,
    informationRequestCount: row.information_request_count,
    currentInformationRequestSequence: row.current_information_request_sequence,
    currentInformationRequestDescription: row.current_information_request_description,
    rejectionReason: row.rejection_reason,
    appealExpiresAt: row.appeal_expires_at,
    memberAcknowledgedRejection: row.member_acknowledged_rejection,
    archivedAt: row.archived_at,
    auditSequence: row.audit_sequence,
  };
}

export class ClaimRepository {
  constructor(private readonly database: DatabaseExecutor) {}

  async create(input: CreateClaimInput): Promise<ClaimRecord> {
    const result = await this.database.query<ClaimRow>(
      `INSERT INTO claims (
         id, state, amount, policy_limit, required_documents, assessor_id,
         assessment_report, assessment_report_complete, information_request_count
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8, $9)
       RETURNING ${claimColumns}`,
      [
        input.id,
        input.state ?? "SUBMITTED",
        input.amount,
        input.policyLimit,
        JSON.stringify(input.requiredDocuments ?? []),
        input.assessorId ?? null,
        input.assessmentReport === undefined ? null : JSON.stringify(input.assessmentReport),
        input.assessmentReportComplete ?? false,
        input.informationRequestCount ?? 0,
      ],
    );
    return mapClaim(result.rows[0]!);
  }

  async findById(claimId: string): Promise<ClaimRecord | null> {
    const result = await this.database.query<ClaimRow>(
      `SELECT ${claimColumns} FROM claims WHERE id = $1`,
      [claimId],
    );
    return result.rows[0] === undefined ? null : mapClaim(result.rows[0]);
  }

  async lockById(claimId: string): Promise<ClaimRecord | null> {
    const result = await this.database.query<ClaimRow>(
      `SELECT ${claimColumns} FROM claims WHERE id = $1 FOR UPDATE`,
      [claimId],
    );
    return result.rows[0] === undefined ? null : mapClaim(result.rows[0]);
  }

  async findPaymentRequest(claimId: string): Promise<PaymentRequestRecord | null> {
    const result = await this.database.query<PaymentRequestRow>(
      `SELECT id, claim_id, amount, status, confirmed, payment_reference
       FROM payment_requests WHERE claim_id = $1`,
      [claimId],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : {
          id: row.id,
          claimId: row.claim_id,
          amount: Number(row.amount),
          status: row.status,
          confirmed: row.confirmed,
          paymentReference: row.payment_reference,
        };
  }

  async currentRequestHasValidInformation(claim: ClaimRecord): Promise<boolean> {
    if (claim.informationRequestCount === 0) {
      return false;
    }
    const result = await this.database.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM additional_information
         WHERE claim_id = $1 AND request_sequence = $2 AND is_valid = true
       ) AS exists`,
      [claim.id, claim.informationRequestCount],
    );
    return result.rows[0]?.exists === true;
  }

  async listAudit(claimId: string): Promise<readonly AuditRecord[]> {
    const result = await this.database.query<AuditRow>(
      `SELECT claim_id, sequence, occurred_at, from_state, to_state, transition_id,
              triggered_by_user_id, triggered_by_role, reason
       FROM claim_audit WHERE claim_id = $1 ORDER BY sequence`,
      [claimId],
    );
    return result.rows.map((row) => ({
      claimId: row.claim_id,
      sequence: row.sequence,
      occurredAt: row.occurred_at,
      fromState: row.from_state,
      toState: row.to_state,
      transitionId: row.transition_id,
      triggeredByUserId: row.triggered_by_user_id,
      triggeredByRole: row.triggered_by_role,
      reason: row.reason,
    }));
  }
}

export class ClaimPrerequisiteService {
  constructor(private readonly pool: Pool) {}

  async createClaim(input: CreateClaimInput): Promise<ClaimRecord> {
    return new ClaimRepository(this.pool).create(input);
  }

  async setRequiredDocuments(
    claimId: string,
    documents: readonly RequiredDocument[],
  ): Promise<void> {
    await this.expectOne(
      "UPDATE claims SET required_documents = $2::jsonb, updated_at = clock_timestamp() WHERE id = $1",
      [claimId, JSON.stringify(documents)],
    );
  }

  async assignAssessor(claimId: string, assessorId: string): Promise<void> {
    await this.expectOne(
      "UPDATE claims SET assessor_id = $2, updated_at = clock_timestamp() WHERE id = $1",
      [claimId, assessorId],
    );
  }

  async completeAssessment(
    claimId: string,
    report: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await this.expectOne(
      `UPDATE claims SET assessment_report = $2::jsonb,
         assessment_report_complete = true, updated_at = clock_timestamp() WHERE id = $1`,
      [claimId, JSON.stringify(report)],
    );
  }

  async recordAdditionalInformation(
    claimId: string,
    isValid: boolean,
    metadata: Readonly<Record<string, unknown>>,
  ): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const repository = new ClaimRepository(client);
      const claim = await repository.lockById(claimId);
      if (claim === null) {
        throw new Error(`Claim not found: ${claimId}`);
      }
      if (claim.state !== "PENDING_INFO" || claim.informationRequestCount < 1) {
        throw new Error("Additional information can only be recorded for the active request");
      }
      await client.query(
        `INSERT INTO additional_information
           (claim_id, request_sequence, is_valid, metadata)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [claimId, claim.informationRequestCount, isValid, JSON.stringify(metadata)],
      );
      await client.query("COMMIT");
      return claim.informationRequestCount;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async confirmPayment(claimId: string, paymentReference: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE payment_requests SET confirmed = true, payment_reference = $2,
         confirmed_at = clock_timestamp()
       WHERE claim_id = $1 AND status = 'INITIATED'`,
      [claimId, paymentReference],
    );
    if (result.rowCount !== 1) {
      throw new Error(`Initiated payment request not found for claim: ${claimId}`);
    }
  }

  async acknowledgeRejection(claimId: string): Promise<void> {
    await this.expectOne(
      `UPDATE claims SET member_acknowledged_rejection = true,
         updated_at = clock_timestamp() WHERE id = $1`,
      [claimId],
    );
  }

  private async expectOne(sql: string, values: unknown[]): Promise<void> {
    const result = await this.pool.query(sql, values);
    if (result.rowCount !== 1) {
      throw new Error(`Claim not found: ${String(values[0])}`);
    }
  }
}
