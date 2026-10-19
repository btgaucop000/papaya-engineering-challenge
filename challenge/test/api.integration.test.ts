import "reflect-metadata";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";

import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { Pool } from "pg";
import request from "supertest";

import { ClaimsApiModule, configureClaimsApi } from "../src/api/index.js";
import {
  AfterCommitEffectRegistry,
  ClaimPrerequisiteService,
  ClaimRepository,
  migrateDatabase,
  ownerDatabaseUrl,
  runtimeDatabaseUrl,
} from "../src/persistence/index.js";
import type { CreateClaimInput, RequiredDocument } from "../src/persistence/index.js";
import { loadWorkflowDefinition } from "../src/workflow/index.js";
import type { WorkflowDefinition } from "../src/workflow/index.js";

const users = {
  documentClerk: "demo-document-clerk",
  teamLead: "demo-team-lead",
  assessor: "demo-assessor",
  finance: "demo-finance",
} as const;

const validDocument: RequiredDocument = {
  type: "claim_form",
  required: true,
  present: true,
  valid: true,
};

const invalidDocument: RequiredDocument = {
  ...validDocument,
  present: false,
  valid: false,
};

let ownerPool: Pool;
let runtimePool: Pool;
let prerequisites: ClaimPrerequisiteService;
let definition: WorkflowDefinition;
let app: INestApplication;

async function assertTestDatabase(pool: Pool): Promise<void> {
  const result = await pool.query<{ current_database: string }>(
    "SELECT current_database() AS current_database",
  );
  const databaseName = result.rows[0]?.current_database ?? "";
  assert.match(
    databaseName,
    /_test$/,
    `Refusing API integration-test cleanup outside a _test database: ${databaseName}`,
  );
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

function api() {
  return request(app.getHttpServer());
}

before(async () => {
  await migrateDatabase(ownerDatabaseUrl(true));
  ownerPool = new Pool({ connectionString: ownerDatabaseUrl(true), max: 4 });
  runtimePool = new Pool({ connectionString: runtimeDatabaseUrl(true), max: 10 });
  await assertTestDatabase(ownerPool);
  await assertTestDatabase(runtimePool);
  prerequisites = new ClaimPrerequisiteService(runtimePool);
  definition = await loadWorkflowDefinition(resolve("challenge/config/claims-workflow.json"));

  const afterCommitEffects = new AfterCommitEffectRegistry({
    notify_assessor_team: async () => {
      throw new Error("simulated assessor notification outage");
    },
    notify_member: async () => undefined,
    invoke_payment_system: async () => undefined,
  });
  const testingModule = await Test.createTestingModule({
    imports: [
      ClaimsApiModule.register({
        pool: runtimePool,
        definition,
        applicationOptions: { afterCommitEffects },
      }),
    ],
  }).compile();
  app = testingModule.createNestApplication();
  configureClaimsApi(app);
  await app.init();
});

beforeEach(async () => {
  await assertTestDatabase(ownerPool);
  await ownerPool.query(
    "TRUNCATE TABLE claim_audit, additional_information, payment_requests, claims RESTART IDENTITY CASCADE",
  );
});

after(async () => {
  await app.close();
  await runtimePool.end();
  await ownerPool.end();
});

describe("NestJS claims API with PostgreSQL", () => {
  test("API-01 lists server-defined demo users and sample claims and returns claim detail", async () => {
    const claimId = await createClaim();

    const demoUsers = await api().get("/api/demo-users").expect(200);
    assert.deepEqual(
      demoUsers.body.map((user: { id: string; role: string }) => [user.id, user.role]),
      [
        [users.documentClerk, "document_clerk"],
        [users.teamLead, "team_lead"],
        [users.assessor, "assessor"],
        [users.finance, "finance"],
      ],
    );

    const list = await api().get("/api/claims").expect(200);
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].id, claimId);
    assert.equal(list.body[0].state, "SUBMITTED");

    const detail = await api().get(`/api/claims/${claimId}`).expect(200);
    assert.equal(detail.body.id, claimId);
    assert.equal(detail.body.policyLimit, 1_000);
    assert.equal(detail.body.paymentRequest, null);
  });

  test("API-02 validates input and rejects attempts to mutate protected fields", async () => {
    const claimId = await createClaim({ requiredDocuments: [invalidDocument] });

    const response = await api()
      .put(`/api/claims/${claimId}/documents`)
      .set("x-demo-user-id", users.documentClerk)
      .send({
        documents: [validDocument],
        state: "APPROVED",
        policyLimit: 999_999,
        informationRequestCount: 99,
        auditSequence: 99,
      })
      .expect(400);

    assert.equal(response.body.code, "VALIDATION_ERROR");
    assert.ok(response.body.details.violations.some((entry: string) => entry.includes("state")));
    const claim = await new ClaimRepository(runtimePool).findById(claimId);
    assert.equal(claim?.state, "SUBMITTED");
    assert.equal(claim?.policyLimit, 1_000);
    assert.equal(claim?.informationRequestCount, 0);
    assert.equal(claim?.auditSequence, 0);
    assert.deepEqual(claim?.requiredDocuments, [invalidDocument]);
  });

  test("API-03 resolves roles on the server and rejects wrong or forged roles", async () => {
    const claimId = await createClaim();

    const wrongUser = await api()
      .post(`/api/claims/${claimId}/transitions`)
      .set("x-demo-user-id", users.assessor)
      .send({ transitionId: "verify_documents" })
      .expect(403);
    assert.equal(wrongUser.body.code, "UNAUTHORIZED_ROLE");
    assert.deepEqual(wrongUser.body.details.requiredRoles, ["document_clerk"]);

    const forgedRole = await api()
      .post(`/api/claims/${claimId}/transitions`)
      .set("x-demo-user-id", users.assessor)
      .send({ transitionId: "verify_documents", role: "document_clerk" })
      .expect(400);
    assert.equal(forgedRole.body.code, "VALIDATION_ERROR");
    assert.equal((await new ClaimRepository(runtimePool).listAudit(claimId)).length, 0);
  });

  test("API-04 previews required roles and unmet conditions without writing data", async () => {
    const claimId = await createClaim({ requiredDocuments: [invalidDocument] });
    const repository = new ClaimRepository(runtimePool);
    const before = await repository.findById(claimId);

    const response = await api()
      .get(`/api/claims/${claimId}/transitions`)
      .set("x-demo-user-id", users.documentClerk)
      .expect(200);

    assert.equal(response.body.length, 1);
    assert.equal(response.body[0].transitionId, "verify_documents");
    assert.deepEqual(response.body[0].requiredRoles, ["document_clerk"]);
    assert.equal(response.body[0].authorized, true);
    assert.equal(response.body[0].available, false);
    assert.equal(response.body[0].unmetConditions[0].code, "CONDITION_NOT_MET");
    assert.deepEqual(await repository.findById(claimId), before);
    assert.deepEqual(await repository.listAudit(claimId), []);
  });

  test("API-05 maps transition precondition failures to a specific 422 response", async () => {
    const claimId = await createClaim({ requiredDocuments: [invalidDocument] });

    const response = await api()
      .post(`/api/claims/${claimId}/transitions`)
      .set("x-demo-user-id", users.documentClerk)
      .send({ transitionId: "verify_documents" })
      .expect(422);

    assert.equal(response.body.code, "PRECONDITION_FAILED");
    assert.equal(response.body.details.transitionId, "verify_documents");
    assert.match(response.body.details.failures[0].message, /required documents/i);
  });

  test("API-06 enforces role and state for prerequisite operations", async () => {
    const claimId = await createClaim({ requiredDocuments: [invalidDocument] });

    const forbidden = await api()
      .put(`/api/claims/${claimId}/documents`)
      .set("x-demo-user-id", users.teamLead)
      .send({ documents: [validDocument] })
      .expect(403);
    assert.equal(forbidden.body.code, "OPERATION_FORBIDDEN");

    const wrongState = await api()
      .put(`/api/claims/${claimId}/assessor`)
      .set("x-demo-user-id", users.teamLead)
      .send({ assessorId: users.assessor })
      .expect(409);
    assert.equal(wrongState.body.code, "INVALID_PREREQUISITE_STATE");

    await api()
      .put(`/api/claims/${claimId}/documents`)
      .set("x-demo-user-id", users.documentClerk)
      .send({ documents: [validDocument] })
      .expect(200);
  });

  test("API-07 completes the valid approval and payment path with ordered audit", async () => {
    const claimId = await createClaim();

    await api()
      .post(`/api/claims/${claimId}/transitions`)
      .set("x-demo-user-id", users.documentClerk)
      .send({ transitionId: "verify_documents" })
      .expect(200);
    await api()
      .put(`/api/claims/${claimId}/assessor`)
      .set("x-demo-user-id", users.teamLead)
      .send({ assessorId: users.assessor })
      .expect(200);
    await api()
      .post(`/api/claims/${claimId}/transitions`)
      .set("x-demo-user-id", users.teamLead)
      .send({ transitionId: "start_assessment" })
      .expect(200);
    await api()
      .put(`/api/claims/${claimId}/assessment-report`)
      .set("x-demo-user-id", users.assessor)
      .send({ report: { conclusion: "approve", score: 92 } })
      .expect(200);
    await api()
      .post(`/api/claims/${claimId}/transitions`)
      .set("x-demo-user-id", users.assessor)
      .send({ transitionId: "approve_claim", reason: "Assessment complete" })
      .expect(200);
    await api()
      .post(`/api/claims/${claimId}/transitions`)
      .set("x-demo-user-id", users.finance)
      .send({ transitionId: "initiate_payment" })
      .expect(200);
    await api()
      .put(`/api/claims/${claimId}/payment-confirmation`)
      .set("x-demo-user-id", users.finance)
      .send({ paymentReference: "PAY-DEMO-001" })
      .expect(200);
    await api()
      .post(`/api/claims/${claimId}/transitions`)
      .set("x-demo-user-id", users.finance)
      .send({ transitionId: "close_paid_claim" })
      .expect(200);

    const detail = await api().get(`/api/claims/${claimId}`).expect(200);
    assert.equal(detail.body.state, "CLOSED");
    assert.equal(detail.body.paymentRequest.status, "INITIATED");
    assert.equal(detail.body.paymentRequest.confirmed, true);
    assert.equal(detail.body.paymentRequest.paymentReference, "PAY-DEMO-001");

    const audit = await api().get(`/api/claims/${claimId}/audit`).expect(200);
    assert.deepEqual(
      audit.body.map((entry: { sequence: number; transitionId: string }) => [
        entry.sequence,
        entry.transitionId,
      ]),
      [
        [1, "verify_documents"],
        [2, "start_assessment"],
        [3, "approve_claim"],
        [4, "initiate_payment"],
        [5, "close_paid_claim"],
      ],
    );
  });

  test("API-08 binds additional information to the active server-side sequence", async () => {
    const claimId = await createClaim({
      state: "UNDER_ASSESSMENT",
      assessorId: users.assessor,
    });
    await api()
      .post(`/api/claims/${claimId}/transitions`)
      .set("x-demo-user-id", users.assessor)
      .send({
        transitionId: "request_more_info",
        missingInfoDescription: "Please upload a clearer invoice",
      })
      .expect(200);

    await api()
      .post(`/api/claims/${claimId}/additional-information`)
      .set("x-demo-user-id", users.documentClerk)
      .send({ isValid: true, metadata: { fileName: "invoice-v2.pdf" }, requestSequence: 999 })
      .expect(400);

    const recorded = await api()
      .post(`/api/claims/${claimId}/additional-information`)
      .set("x-demo-user-id", users.documentClerk)
      .send({ isValid: true, metadata: { fileName: "invoice-v2.pdf" } })
      .expect(201);
    assert.equal(recorded.body.requestSequence, 1);

    await api()
      .post(`/api/claims/${claimId}/transitions`)
      .set("x-demo-user-id", users.documentClerk)
      .send({ transitionId: "receive_additional_info" })
      .expect(200);
    assert.equal((await new ClaimRepository(runtimePool).findById(claimId))?.state, "DOCUMENTS_VERIFIED");
  });

  test("API-09 exposes member acknowledgement and a fixed system-only action", async () => {
    const claimId = await createClaim({
      state: "UNDER_ASSESSMENT",
      assessorId: users.assessor,
      assessmentReport: { conclusion: "reject" },
      assessmentReportComplete: true,
    });
    await api()
      .post(`/api/claims/${claimId}/transitions`)
      .set("x-demo-user-id", users.assessor)
      .send({ transitionId: "reject_claim", rejectionReason: "Policy exclusion applies" })
      .expect(200);

    const protectedSystemInput = await api()
      .post(`/api/claims/${claimId}/system-actions/run`)
      .send({ transitionId: "approve_claim", role: "assessor" })
      .expect(400);
    assert.equal(protectedSystemInput.body.code, "VALIDATION_ERROR");

    const premature = await api()
      .post(`/api/claims/${claimId}/system-actions/run`)
      .send({})
      .expect(422);
    assert.equal(premature.body.code, "PRECONDITION_FAILED");

    await api().post(`/api/claims/${claimId}/member-acknowledgement`).send({}).expect(200);
    await api().post(`/api/claims/${claimId}/system-actions/run`).send({}).expect(200);

    const audit = await api().get(`/api/claims/${claimId}/audit`).expect(200);
    assert.equal(audit.body[1].transitionId, "close_rejected_claim");
    assert.equal(audit.body[1].triggeredByUserId, "demo-system");
    assert.equal(audit.body[1].triggeredByRole, "system");
  });

  test("API-10 returns an effect warning while keeping the committed transition successful", async () => {
    const claimId = await createClaim();

    const response = await api()
      .post(`/api/claims/${claimId}/transitions`)
      .set("x-demo-user-id", users.documentClerk)
      .send({ transitionId: "verify_documents" })
      .expect(200);

    assert.equal(response.body.toState, "DOCUMENTS_VERIFIED");
    assert.deepEqual(response.body.effectWarnings, [
      {
        effectType: "notify_assessor_team",
        message: "simulated assessor notification outage",
      },
    ]);
    const repository = new ClaimRepository(runtimePool);
    assert.equal((await repository.findById(claimId))?.state, "DOCUMENTS_VERIFIED");
    assert.equal((await repository.listAudit(claimId)).length, 1);
  });

  test("API-11 maps identity, not-found, and invalid-transition errors", async () => {
    const claimId = await createClaim();

    const missingIdentity = await api()
      .post(`/api/claims/${claimId}/transitions`)
      .send({ transitionId: "verify_documents" })
      .expect(401);
    assert.equal(missingIdentity.body.code, "UNKNOWN_DEMO_USER");

    const missingClaim = await api().get(`/api/claims/${randomUUID()}`).expect(404);
    assert.equal(missingClaim.body.code, "CLAIM_NOT_FOUND");

    const invalidTransition = await api()
      .post(`/api/claims/${claimId}/transitions`)
      .set("x-demo-user-id", users.documentClerk)
      .send({ transitionId: "approve_claim" })
      .expect(409);
    assert.equal(invalidTransition.body.code, "INVALID_TRANSITION");
    assert.deepEqual(invalidTransition.body.details.allowedTransitionIds, ["verify_documents"]);
  });
});
