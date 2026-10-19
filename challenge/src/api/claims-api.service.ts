import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";

import {
  ClaimApplicationService,
  ClaimNotFoundError,
  ClaimPrerequisiteService,
  ClaimRepository,
} from "../persistence/index.js";
import type { RequiredDocument, TransitionCommand } from "../persistence/index.js";
import {
  demoSystemActor,
  demoUsers,
  OperationForbiddenError,
  requireDemoRole,
  resolveDemoActor,
} from "./demo-identities.js";
import type {
  CompleteAssessmentDto,
  ConfirmPaymentDto,
  RecordAdditionalInformationDto,
  SetDocumentsDto,
  TransitionDto,
} from "./dto.js";
import { CLAIM_APPLICATION_SERVICE, DATABASE_POOL } from "./tokens.js";

@Injectable()
export class ClaimsApiService {
  private readonly repository: ClaimRepository;
  private readonly prerequisites: ClaimPrerequisiteService;

  constructor(
    @Inject(DATABASE_POOL) pool: Pool,
    @Inject(CLAIM_APPLICATION_SERVICE)
    private readonly application: ClaimApplicationService,
  ) {
    this.repository = new ClaimRepository(pool);
    this.prerequisites = new ClaimPrerequisiteService(pool);
  }

  listDemoUsers(): typeof demoUsers {
    return demoUsers;
  }

  async listClaims() {
    const claims = await this.repository.list();
    return claims.map((claim) => ({
      id: claim.id,
      state: claim.state,
      amount: claim.amount,
      policyLimit: claim.policyLimit,
      informationRequestCount: claim.informationRequestCount,
    }));
  }

  async getClaim(claimId: string) {
    const claim = await this.repository.findById(claimId);
    if (claim === null) {
      throw new ClaimNotFoundError(claimId);
    }
    const paymentRequest = await this.repository.findPaymentRequest(claimId);
    return { ...claim, paymentRequest };
  }

  async previewTransitions(claimId: string, userId: string | undefined) {
    return this.application.previewTransitions(claimId, resolveDemoActor(userId));
  }

  async transition(claimId: string, userId: string | undefined, input: TransitionDto) {
    const actor = resolveDemoActor(userId);
    const command: TransitionCommand = {
      claimId,
      transitionId: input.transitionId,
      actor,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      ...(input.rejectionReason === undefined
        ? {}
        : { rejectionReason: input.rejectionReason }),
      ...(input.missingInfoDescription === undefined
        ? {}
        : { missingInfoDescription: input.missingInfoDescription }),
    };
    return this.application.transition(command);
  }

  async listAudit(claimId: string) {
    await this.ensureClaimExists(claimId);
    return this.repository.listAudit(claimId);
  }

  async setDocuments(
    claimId: string,
    userId: string | undefined,
    input: SetDocumentsDto,
  ) {
    requireDemoRole(userId, "set_required_documents", ["document_clerk"]);
    await this.prerequisites.setRequiredDocuments(
      claimId,
      input.documents as readonly RequiredDocument[],
    );
    return this.getClaim(claimId);
  }

  async assignAssessor(
    claimId: string,
    userId: string | undefined,
    assessorId: string,
  ) {
    requireDemoRole(userId, "assign_assessor", ["team_lead"]);
    const target = resolveDemoActor(assessorId);
    if (target.role !== "assessor") {
      throw new OperationForbiddenError("assign_assessor_target", target.role, ["assessor"]);
    }
    await this.prerequisites.assignAssessor(claimId, target.userId);
    return this.getClaim(claimId);
  }

  async completeAssessment(
    claimId: string,
    userId: string | undefined,
    input: CompleteAssessmentDto,
  ) {
    const actor = requireDemoRole(userId, "complete_assessment", ["assessor"]);
    await this.prerequisites.completeAssessment(claimId, input.report, actor.userId);
    return this.getClaim(claimId);
  }

  async recordAdditionalInformation(
    claimId: string,
    userId: string | undefined,
    input: RecordAdditionalInformationDto,
  ) {
    requireDemoRole(userId, "record_additional_information", ["document_clerk"]);
    const requestSequence = await this.prerequisites.recordAdditionalInformation(
      claimId,
      input.isValid,
      input.metadata,
    );
    return { claimId, requestSequence };
  }

  async confirmPayment(
    claimId: string,
    userId: string | undefined,
    input: ConfirmPaymentDto,
  ) {
    requireDemoRole(userId, "confirm_payment", ["finance"]);
    await this.prerequisites.confirmPayment(claimId, input.paymentReference);
    return this.getClaim(claimId);
  }

  async acknowledgeRejection(claimId: string) {
    await this.prerequisites.acknowledgeRejection(claimId);
    return {
      claimId,
      acknowledged: true,
      actor: { userId: "demo-member", kind: "fixed-demo-operation" },
    };
  }

  async runEligibleSystemAction(claimId: string) {
    return this.application.transition({
      claimId,
      transitionId: "close_rejected_claim",
      actor: demoSystemActor,
      reason: "Eligible demo system action",
    });
  }

  private async ensureClaimExists(claimId: string): Promise<void> {
    if ((await this.repository.findById(claimId)) === null) {
      throw new ClaimNotFoundError(claimId);
    }
  }
}
