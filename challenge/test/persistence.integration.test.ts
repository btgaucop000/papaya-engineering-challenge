import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";

import { Pool } from "pg";

import {
  InvalidTransitionError,
  loadWorkflowDefinition,
  WorkflowEngine,
} from "../src/workflow/index.js";
import {
  AfterCommitEffectRegistry,
  ClaimApplicationService,
  ClaimPrerequisiteService,
  ClaimRepository,
  createLoggingAfterCommitHandlers,
  migrateDatabase,
  ownerDatabaseUrl,
  runtimeDatabaseUrl,
} from "../src/persistence/index.js";
import type {
  ClaimApplicationServiceOptions,
  CreateClaimInput,
  RequiredDocument,
} from "../src/persistence/index.js";
import type { WorkflowDefinition } from "../src/workflow/index.js";

const validDocument: RequiredDocument = {
  type: "claim_form",
  required: true,
  present: true,
  valid: true,
};

const documentClerk = { userId: "demo-document-clerk", role: "document_clerk" };
const assessor = { userId: "demo-assessor", role: "assessor" };

let ownerPool: Pool;
let runtimePool: Pool;
let prerequisites: ClaimPrerequisiteService;
let definition: WorkflowDefinition;
let engine: WorkflowEngine;

function applicationService(options: ClaimApplicationServiceOptions = {}): ClaimApplicationService {
  return new ClaimApplicationService(runtimePool, engine, definition, {
    afterCommitEffects: new AfterCommitEffectRegistry(
      createLoggingAfterCommitHandlers(() => undefined),
    ),
    ...options,
  });
}

async function createClaim(input: Partial<CreateClaimInput> = {}): Promise<string> {
  const id = input.id ?? randomUUID();
  await prerequisites.createClaim({
    id,
    state: input.state ?? "SUBMITTED",
    amount: input.amount ?? 500,
    policyLimit: input.policyLimit ?? 1_000,
    requiredDocuments: input.requiredDocuments ?? [validDocument],
    assessorId: input.assessorId ?? null,
    assessmentReport: input.assessmentReport ?? null,
    assessmentReportComplete: input.assessmentReportComplete ?? false,
    informationRequestCount: input.informationRequestCount ?? 0,
  });
  return id;
}

async function assertTestDatabase(pool: Pool): Promise<void> {
  const result = await pool.query<{ current_database: string }>(
    "SELECT current_database() AS current_database",
  );
  const databaseName = result.rows[0]?.current_database ?? "";
  assert.match(
    databaseName,
    /_test$/,
    `Refusing integration-test cleanup outside a _test database: ${databaseName}`,
  );
}

before(async () => {
  await migrateDatabase(ownerDatabaseUrl(true));
  ownerPool = new Pool({ connectionString: ownerDatabaseUrl(true), max: 4 });
  runtimePool = new Pool({ connectionString: runtimeDatabaseUrl(true), max: 10 });
  await assertTestDatabase(ownerPool);
  await assertTestDatabase(runtimePool);

  definition = await loadWorkflowDefinition(resolve("challenge/config/claims-workflow.json"));
  engine = new WorkflowEngine(definition);
  prerequisites = new ClaimPrerequisiteService(runtimePool);
});

beforeEach(async () => {
  await assertTestDatabase(ownerPool);
  await ownerPool.query(
    "TRUNCATE TABLE claim_audit, additional_information, payment_requests, claims RESTART IDENTITY CASCADE",
  );
});

after(async () => {
  await runtimePool.end();
  await ownerPool.end();
});

describe("PostgreSQL workflow persistence", () => {
  test("persists an accepted transition and its ordered audit record atomically", async () => {
    const claimId = await createClaim();

    const result = await applicationService().transition({
      claimId,
      transitionId: "verify_documents",
      actor: documentClerk,
      reason: "All supplied documents were checked",
    });

    assert.equal(result.fromState, "SUBMITTED");
    assert.equal(result.toState, "DOCUMENTS_VERIFIED");
    assert.equal(result.auditSequence, 1);

    const repository = new ClaimRepository(runtimePool);
    const claim = await repository.findById(claimId);
    const audit = await repository.listAudit(claimId);
    assert.equal(claim?.state, "DOCUMENTS_VERIFIED");
    assert.equal(claim?.auditSequence, 1);
    assert.deepEqual(
      audit.map((entry) => ({
        sequence: entry.sequence,
        from: entry.fromState,
        to: entry.toState,
        transition: entry.transitionId,
        user: entry.triggeredByUserId,
        role: entry.triggeredByRole,
        reason: entry.reason,
      })),
      [
        {
          sequence: 1,
          from: "SUBMITTED",
          to: "DOCUMENTS_VERIFIED",
          transition: "verify_documents",
          user: documentClerk.userId,
          role: documentClerk.role,
          reason: "All supplied documents were checked",
        },
      ],
    );
  });

  test("a rejected transition does not modify claim, counter, audit, or payment data", async () => {
    const claimId = await createClaim();
    const repository = new ClaimRepository(runtimePool);
    const beforeClaim = await repository.findById(claimId);

    await assert.rejects(
      applicationService().transition({
        claimId,
        transitionId: "approve_claim",
        actor: assessor,
      }),
      InvalidTransitionError,
    );

    const afterClaim = await repository.findById(claimId);
    assert.deepEqual(afterClaim, beforeClaim);
    assert.deepEqual(await repository.listAudit(claimId), []);
    assert.equal(await repository.findPaymentRequest(claimId), null);
  });

  test("an audit insert error rolls back the state and audit sequence", async () => {
    const claimId = await createClaim();

    await assert.rejects(
      applicationService().transition({
        claimId,
        transitionId: "verify_documents",
        actor: { userId: "x".repeat(101), role: "document_clerk" },
      }),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "22001",
    );

    const repository = new ClaimRepository(runtimePool);
    const claim = await repository.findById(claimId);
    assert.equal(claim?.state, "SUBMITTED");
    assert.equal(claim?.auditSequence, 0);
    assert.deepEqual(await repository.listAudit(claimId), []);
  });

  test("a transactional payment effect error rolls back state and audit", async () => {
    const claimId = await createClaim({
      state: "UNDER_ASSESSMENT",
      assessorId: assessor.userId,
      assessmentReport: { conclusion: "approve" },
      assessmentReportComplete: true,
    });
    await runtimePool.query(
      `INSERT INTO payment_requests (id, claim_id, amount, status, created_at)
       VALUES ($1, $2, 500, 'REQUESTED', clock_timestamp())`,
      [randomUUID(), claimId],
    );

    await assert.rejects(
      applicationService().transition({
        claimId,
        transitionId: "approve_claim",
        actor: assessor,
      }),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23505",
    );

    const repository = new ClaimRepository(runtimePool);
    const claim = await repository.findById(claimId);
    assert.equal(claim?.state, "UNDER_ASSESSMENT");
    assert.equal(claim?.auditSequence, 0);
    assert.deepEqual(await repository.listAudit(claimId), []);
    const payments = await runtimePool.query<{ count: string }>(
      "SELECT count(*) AS count FROM payment_requests WHERE claim_id = $1",
      [claimId],
    );
    assert.equal(Number(payments.rows[0]?.count), 1);
  });

  test("the runtime database role cannot update or delete audit rows", async () => {
    const claimId = await createClaim();
    await applicationService().transition({
      claimId,
      transitionId: "verify_documents",
      actor: documentClerk,
    });

    await assert.rejects(
      runtimePool.query(
        "UPDATE claim_audit SET reason = 'tampered' WHERE claim_id = $1",
        [claimId],
      ),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error.code === "42501" || error.code === "55000"),
    );
    await assert.rejects(
      runtimePool.query("DELETE FROM claim_audit WHERE claim_id = $1", [claimId]),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error.code === "42501" || error.code === "55000"),
    );
    await assert.rejects(
      ownerPool.query("UPDATE claim_audit SET reason = 'owner tamper' WHERE claim_id = $1", [
        claimId,
      ]),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "55000",
    );
    await assert.rejects(
      ownerPool.query("DELETE FROM claim_audit WHERE claim_id = $1", [claimId]),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "55000",
    );

    const audit = await new ClaimRepository(runtimePool).listAudit(claimId);
    assert.equal(audit.length, 1);
    assert.equal(audit[0]?.reason, null);
  });

  test("concurrent transitions serialize on the claim and re-evaluate fresh state", async () => {
    const claimId = await createClaim();
    let signalLocked!: () => void;
    let releaseFirst!: () => void;
    const firstLocked = new Promise<void>((resolveLocked) => {
      signalLocked = resolveLocked;
    });
    const firstMayCommit = new Promise<void>((resolveRelease) => {
      releaseFirst = resolveRelease;
    });

    const first = applicationService({
      hooks: {
        afterClaimLocked: async () => {
          signalLocked();
          await firstMayCommit;
        },
      },
    }).transition({ claimId, transitionId: "verify_documents", actor: documentClerk });

    await firstLocked;
    let secondSettled = false;
    const second = applicationService()
      .transition({ claimId, transitionId: "verify_documents", actor: documentClerk })
      .finally(() => {
        secondSettled = true;
      });

    await ownerPool.query("SELECT pg_sleep(0.1)");
    assert.equal(secondSettled, false, "the second transition should be waiting for the row lock");
    releaseFirst();

    const outcomes = await Promise.allSettled([first, second]);
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    assert.ok(rejected?.status === "rejected");
    assert.ok(rejected.reason instanceof InvalidTransitionError);

    const repository = new ClaimRepository(runtimePool);
    assert.equal((await repository.findById(claimId))?.state, "DOCUMENTS_VERIFIED");
    assert.equal((await repository.listAudit(claimId)).length, 1);
  });

  test("only the configured approval effect creates a payment request", async () => {
    const approvedClaimId = await createClaim({
      state: "UNDER_ASSESSMENT",
      assessorId: assessor.userId,
      assessmentReport: { conclusion: "approve" },
      assessmentReportComplete: true,
    });
    const repository = new ClaimRepository(runtimePool);
    assert.equal(await repository.findPaymentRequest(approvedClaimId), null);

    await applicationService().transition({
      claimId: approvedClaimId,
      transitionId: "approve_claim",
      actor: assessor,
    });
    assert.equal((await repository.findPaymentRequest(approvedClaimId))?.status, "REQUESTED");

    const pendingInfoClaimId = await createClaim({
      state: "UNDER_ASSESSMENT",
      assessorId: assessor.userId,
      assessmentReport: { priorWork: "retained" },
      assessmentReportComplete: true,
    });
    await applicationService().transition({
      claimId: pendingInfoClaimId,
      transitionId: "request_more_info",
      actor: assessor,
      missingInfoDescription: "Please provide the original invoice",
    });

    const pendingClaim = await repository.findById(pendingInfoClaimId);
    assert.equal(pendingClaim?.state, "PENDING_INFO");
    assert.equal(pendingClaim?.informationRequestCount, 1);
    assert.equal(pendingClaim?.assessmentReportComplete, false);
    assert.deepEqual(pendingClaim?.assessmentReport, { priorWork: "retained" });
    assert.equal(await repository.findPaymentRequest(pendingInfoClaimId), null);
  });

  test("prerequisite information is bound to the active request sequence", async () => {
    const claimId = await createClaim({ state: "UNDER_ASSESSMENT", assessorId: assessor.userId });
    await applicationService().transition({
      claimId,
      transitionId: "request_more_info",
      actor: assessor,
      missingInfoDescription: "A clearer invoice is required",
    });

    const sequence = await prerequisites.recordAdditionalInformation(claimId, true, {
      fileName: "invoice-v2.pdf",
    });
    assert.equal(sequence, 1);

    const stored = await runtimePool.query<{
      request_sequence: number;
      is_valid: boolean;
      metadata: Record<string, unknown>;
    }>(
      `SELECT request_sequence, is_valid, metadata FROM additional_information
       WHERE claim_id = $1`,
      [claimId],
    );
    assert.deepEqual(stored.rows, [
      {
        request_sequence: 1,
        is_valid: true,
        metadata: { fileName: "invoice-v2.pdf" },
      },
    ]);
  });
});
