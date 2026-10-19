import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { Pool } from "pg";

import {
  AfterCommitEffectRegistry,
  ClaimApplicationService,
  ClaimPrerequisiteService,
  ClaimRepository,
  createLoggingAfterCommitHandlers,
  runtimeDatabaseUrl,
  type AuditRecord,
  type ClaimRecord,
  type PaymentRequestRecord,
  type TransitionCommand,
} from "../persistence/index.js";
import {
  InvalidTransitionError,
  UnauthorizedRoleError,
  WorkflowEngine,
  loadWorkflowDefinition,
  type Actor,
} from "../workflow/index.js";

const actors = {
  clerk: { userId: "demo-document-clerk", role: "document_clerk" },
  lead: { userId: "demo-team-lead", role: "team_lead" },
  assessor: { userId: "demo-assessor", role: "assessor" },
  finance: { userId: "demo-finance", role: "finance" },
  system: { userId: "demo-system", role: "system" },
} as const satisfies Readonly<Record<string, Actor>>;

type FailureOutput = {
  readonly code: string;
  readonly message: string;
};

type ScenarioOutput = {
  readonly id: string;
  readonly name: string;
  readonly claimId: string;
  readonly status: "PASS";
  readonly finalState: string;
  readonly informationRequestCount: number;
  readonly auditCount: number;
  readonly audit: readonly AuditRecord[];
  readonly error?: FailureOutput;
  readonly unchangedAfterFailure?: boolean;
  readonly paymentReference?: string;
  readonly activeInformationSequence?: number;
};

type Snapshot = {
  readonly claim: ClaimRecord;
  readonly audit: readonly AuditRecord[];
  readonly payment: PaymentRequestRecord | null;
};

const connectionString = runtimeDatabaseUrl(true);
const pool = new Pool({ connectionString, max: 5 });
const definition = await loadWorkflowDefinition(
  resolve("challenge/config/claims-workflow.json"),
);
const effects: unknown[] = [];
const application = new ClaimApplicationService(
  pool,
  new WorkflowEngine(definition),
  definition,
  {
    afterCommitEffects: new AfterCommitEffectRegistry(
      createLoggingAfterCommitHandlers((message) => {
        effects.push(JSON.parse(message) as unknown);
      }),
    ),
  },
);
const prerequisites = new ClaimPrerequisiteService(pool);
const repository = new ClaimRepository(pool);

async function verifyDatabaseBoundary(): Promise<string> {
  const result = await pool.query<{ current_database: string }>(
    "SELECT current_database() AS current_database",
  );
  const databaseName = result.rows[0]?.current_database ?? "";
  if (!databaseName.endsWith("_test")) {
    throw new Error(`Refusing scenario verification outside a _test database: ${databaseName}`);
  }
  return databaseName;
}

async function createScenarioClaim(): Promise<string> {
  const claimId = randomUUID();
  await prerequisites.createClaim({
    id: claimId,
    amount: 500,
    policyLimit: 1_000,
    requiredDocuments: [
      {
        type: "claim_form",
        required: true,
        present: true,
        valid: true,
      },
    ],
  });
  return claimId;
}

async function transition(
  claimId: string,
  transitionId: string,
  actor: Actor,
  fields: Partial<Pick<TransitionCommand, "reason" | "rejectionReason" | "missingInfoDescription">> = {},
): Promise<void> {
  await application.transition({ claimId, transitionId, actor, ...fields });
}

async function reachAssessment(claimId: string): Promise<void> {
  await transition(claimId, "verify_documents", actors.clerk, {
    reason: "Required scenario: documents verified",
  });
  await prerequisites.assignAssessor(claimId, actors.assessor.userId);
  await transition(claimId, "start_assessment", actors.lead, {
    reason: "Required scenario: assessment started",
  });
}

async function completeAssessment(claimId: string, summary: string): Promise<void> {
  await prerequisites.completeAssessment(
    claimId,
    { summary },
    actors.assessor.userId,
  );
}

async function closeApprovedClaim(claimId: string, reference: string): Promise<void> {
  await transition(claimId, "approve_claim", actors.assessor, {
    reason: "Required scenario: claim approved",
  });
  await transition(claimId, "initiate_payment", actors.finance, {
    reason: "Required scenario: payment initiated",
  });
  await prerequisites.confirmPayment(claimId, reference);
  await transition(claimId, "close_paid_claim", actors.finance, {
    reason: "Required scenario: confirmed payment closed",
  });
}

async function snapshot(claimId: string): Promise<Snapshot> {
  const claim = await repository.findById(claimId);
  assert.notEqual(claim, null);
  return {
    claim: claim!,
    audit: await repository.listAudit(claimId),
    payment: await repository.findPaymentRequest(claimId),
  };
}

async function successOutput(
  id: string,
  name: string,
  claimId: string,
  expectedAuditCount: number,
): Promise<ScenarioOutput> {
  const state = await snapshot(claimId);
  assert.equal(state.claim.state, "CLOSED");
  assert.equal(state.audit.length, expectedAuditCount);
  assert.deepEqual(
    state.audit.map((entry) => entry.sequence),
    Array.from({ length: expectedAuditCount }, (_, index) => index + 1),
  );
  return {
    id,
    name,
    claimId,
    status: "PASS",
    finalState: state.claim.state,
    informationRequestCount: state.claim.informationRequestCount,
    auditCount: state.audit.length,
    audit: state.audit,
    ...(state.payment?.paymentReference === null || state.payment === null
      ? {}
      : { paymentReference: state.payment.paymentReference }),
  };
}

function failureDetails(error: unknown): FailureOutput {
  assert.ok(error instanceof Error);
  const code = (error as Error & { readonly code?: unknown }).code;
  if (typeof code !== "string") {
    throw new Error(`Expected a domain error code, received: ${String(code)}`);
  }
  return { code, message: error.message };
}

async function runHappyPath(): Promise<ScenarioOutput> {
  const claimId = await createScenarioClaim();
  await reachAssessment(claimId);
  await completeAssessment(claimId, "Happy-path assessment complete");
  await closeApprovedClaim(claimId, "PAY-HAPPY-001");
  const output = await successOutput("SC-01", "Happy path", claimId, 5);
  assert.equal(output.informationRequestCount, 0);
  assert.equal(output.paymentReference, "PAY-HAPPY-001");
  return output;
}

async function runRejectionPath(): Promise<ScenarioOutput> {
  const claimId = await createScenarioClaim();
  await reachAssessment(claimId);
  await completeAssessment(claimId, "Rejection-path assessment complete");
  await transition(claimId, "reject_claim", actors.assessor, {
    reason: "Required scenario: claim rejected",
    rejectionReason: "Policy exclusion applies",
  });
  await prerequisites.acknowledgeRejection(claimId);
  await transition(claimId, "close_rejected_claim", actors.system, {
    reason: "Required scenario: acknowledged rejection closed",
  });
  const output = await successOutput("SC-02", "Rejection path", claimId, 4);
  assert.equal(output.informationRequestCount, 0);
  return output;
}

async function runInformationLoop(): Promise<ScenarioOutput> {
  const claimId = await createScenarioClaim();
  await reachAssessment(claimId);
  await transition(claimId, "request_more_info", actors.assessor, {
    reason: "Required scenario: additional information requested",
    missingInfoDescription: "Provide the final medical invoice",
  });
  const sequence = await prerequisites.recordAdditionalInformation(
    claimId,
    true,
    { source: "required-scenario-runner" },
  );
  assert.equal(sequence, 1);
  await transition(claimId, "receive_additional_info", actors.clerk, {
    reason: "Required scenario: additional information received",
  });
  await transition(claimId, "start_assessment", actors.lead, {
    reason: "Required scenario: reassessment started",
  });
  await completeAssessment(claimId, "Information-loop assessment complete");
  await closeApprovedClaim(claimId, "PAY-INFO-001");

  const output = await successOutput("SC-03", "Request-info loop", claimId, 8);
  assert.equal(output.informationRequestCount, 1);
  return { ...output, activeInformationSequence: sequence };
}

async function runInvalidTransition(): Promise<ScenarioOutput> {
  const claimId = await createScenarioClaim();
  const before = await snapshot(claimId);
  const effectsBefore = effects.length;
  let error: unknown;
  try {
    await transition(claimId, "approve_claim", actors.assessor, {
      reason: "This transition must fail",
    });
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof InvalidTransitionError);
  const details = failureDetails(error);
  assert.equal(details.code, "INVALID_TRANSITION");
  assert.match(details.message, /SUBMITTED/);
  assert.match(details.message, /verify_documents/);
  const after = await snapshot(claimId);
  assert.deepEqual(after, before);
  assert.equal(effects.length, effectsBefore);
  return {
    id: "SC-04",
    name: "Invalid SUBMITTED to APPROVED transition",
    claimId,
    status: "PASS",
    finalState: after.claim.state,
    informationRequestCount: after.claim.informationRequestCount,
    auditCount: after.audit.length,
    audit: after.audit,
    error: details,
    unchangedAfterFailure: true,
  };
}

async function runWrongRole(): Promise<ScenarioOutput> {
  const claimId = await createScenarioClaim();
  const before = await snapshot(claimId);
  const effectsBefore = effects.length;
  let error: unknown;
  try {
    await transition(claimId, "verify_documents", actors.finance, {
      reason: "This role must fail",
    });
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof UnauthorizedRoleError);
  const details = failureDetails(error);
  assert.equal(details.code, "UNAUTHORIZED_ROLE");
  assert.match(details.message, /finance/);
  assert.match(details.message, /document_clerk/);
  const after = await snapshot(claimId);
  assert.deepEqual(after, before);
  assert.equal(effects.length, effectsBefore);
  return {
    id: "SC-05",
    name: "Wrong role",
    claimId,
    status: "PASS",
    finalState: after.claim.state,
    informationRequestCount: after.claim.informationRequestCount,
    auditCount: after.audit.length,
    audit: after.audit,
    error: details,
    unchangedAfterFailure: true,
  };
}

try {
  const database = await verifyDatabaseBoundary();
  const scenarios = [
    await runHappyPath(),
    await runRejectionPath(),
    await runInformationLoop(),
    await runInvalidTransition(),
    await runWrongRole(),
  ];
  assert.equal(scenarios.length, 5);
  console.log(
    JSON.stringify(
      {
        verification: "Challenge 14 required scenarios",
        generatedAt: new Date().toISOString(),
        database,
        databaseEngine: "PostgreSQL",
        workflowConfig: "challenge/config/claims-workflow.json",
        status: "PASS",
        scenarios,
        mockEffects: effects,
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
