import type { Pool, PoolClient } from "pg";

import type {
  FactContext,
  TransitionPlan,
  WorkflowDefinition,
  WorkflowEngine,
} from "../workflow/index.js";
import { ClaimRepository } from "./claim-repository.js";
import {
  AfterCommitEffectRegistry,
  TransactionalEffectRegistry,
} from "./effect-registry.js";
import type {
  ClaimRecord,
  EffectWarning,
  PersistedTransition,
  TransitionCommand,
} from "./types.js";

export type TransitionServiceHooks = {
  readonly afterClaimLocked?: (client: PoolClient, claim: ClaimRecord) => Promise<void>;
};

export type ClaimApplicationServiceOptions = {
  readonly now?: () => Date;
  readonly transactionalEffects?: TransactionalEffectRegistry;
  readonly afterCommitEffects?: AfterCommitEffectRegistry;
  readonly hooks?: TransitionServiceHooks;
};

export class ClaimApplicationService {
  private readonly now: () => Date;
  private readonly transactionalEffects: TransactionalEffectRegistry;
  private readonly afterCommitEffects: AfterCommitEffectRegistry;
  private readonly hooks: TransitionServiceHooks;

  constructor(
    private readonly pool: Pool,
    private readonly engine: WorkflowEngine,
    private readonly definition: WorkflowDefinition,
    options: ClaimApplicationServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.transactionalEffects = options.transactionalEffects ?? new TransactionalEffectRegistry();
    this.afterCommitEffects = options.afterCommitEffects ?? new AfterCommitEffectRegistry();
    this.hooks = options.hooks ?? {};
  }

  async transition(command: TransitionCommand): Promise<PersistedTransition> {
    const client = await this.pool.connect();
    let plan: TransitionPlan;
    let claim: ClaimRecord;
    let occurredAt: Date;
    let auditSequence: number;

    try {
      await client.query("BEGIN");
      const repository = new ClaimRepository(client);

      const lockedClaim = await repository.lockById(command.claimId);
      if (lockedClaim === null) {
        throw new Error(`Claim not found: ${command.claimId}`);
      }
      claim = lockedClaim;
      await this.hooks.afterClaimLocked?.(client, claim);

      const facts = await this.buildFacts(repository, claim, command);
      plan = this.engine.planTransition({
        currentState: claim.state,
        transitionId: command.transitionId,
        actor: command.actor,
        facts,
        ...(command.reason === undefined ? {} : { reason: command.reason }),
      });

      const nextInformationRequestCount = this.nextInformationRequestCount(claim, plan);
      auditSequence = claim.auditSequence + 1;
      occurredAt = this.now();

      await client.query(
        `UPDATE claims SET state = $2, information_request_count = $3,
           audit_sequence = $4, updated_at = $5 WHERE id = $1`,
        [claim.id, plan.toState, nextInformationRequestCount, auditSequence, occurredAt],
      );

      await client.query(
        `INSERT INTO claim_audit (
           claim_id, sequence, occurred_at, from_state, to_state, transition_id,
           triggered_by_user_id, triggered_by_role, reason
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          claim.id,
          auditSequence,
          occurredAt,
          plan.fromState,
          plan.toState,
          plan.transitionId,
          plan.actor.userId,
          plan.actor.role,
          plan.reason ?? null,
        ],
      );

      for (const effect of plan.transactionalEffects) {
        await this.transactionalEffects.execute(effect, {
          client,
          claim,
          command,
          counterUpdates: plan.counterUpdates,
          now: occurredAt,
          settings: this.definition.settings,
        });
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const effectWarnings: EffectWarning[] = [];
    for (const effect of plan.afterCommitEffects) {
      try {
        await this.afterCommitEffects.execute(effect, {
          claim,
          command,
          counterUpdates: plan.counterUpdates,
          now: occurredAt,
          settings: this.definition.settings,
        });
      } catch (error) {
        effectWarnings.push({
          effectType: effect.type,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      claimId: claim.id,
      transitionId: plan.transitionId,
      fromState: plan.fromState,
      toState: plan.toState,
      auditSequence,
      counterUpdates: plan.counterUpdates,
      effectWarnings,
    };
  }

  private async buildFacts(
    repository: ClaimRepository,
    claim: ClaimRecord,
    command: TransitionCommand,
  ): Promise<FactContext> {
    const paymentRequest = await repository.findPaymentRequest(claim.id);
    const currentRequestHasValidRecord =
      await repository.currentRequestHasValidInformation(claim);
    const requiredDocuments = claim.requiredDocuments.filter((document) => document.required);

    return {
      documents: {
        allRequiredPresentValid:
          requiredDocuments.length > 0 &&
          requiredDocuments.every((document) => document.present && document.valid),
      },
      assessment: {
        assessorAssigned: claim.assessorId !== null,
        reportComplete: claim.assessmentReportComplete,
      },
      claim: { amount: claim.amount },
      policy: { limit: claim.policyLimit },
      command: {
        rejectionReason: command.rejectionReason,
        missingInfoDescription: command.missingInfoDescription,
      },
      information: { currentRequestHasValidRecord },
      workflow: { informationRequestCount: claim.informationRequestCount },
      payment: {
        requestExists: paymentRequest !== null,
        confirmed: paymentRequest?.confirmed,
        reference: paymentRequest?.paymentReference,
      },
      appeal: {
        expired:
          claim.appealExpiresAt === null
            ? undefined
            : claim.appealExpiresAt.getTime() <= this.now().getTime(),
      },
      rejection: { memberAcknowledged: claim.memberAcknowledgedRejection },
    };
  }

  private nextInformationRequestCount(claim: ClaimRecord, plan: TransitionPlan): number {
    let nextCount = claim.informationRequestCount;
    for (const update of plan.counterUpdates) {
      if (update.fact !== "workflow.informationRequestCount") {
        throw new Error(`No persistence mapping registered for counter fact: ${update.fact}`);
      }
      if (update.previousValue !== nextCount) {
        throw new Error(`Counter changed after the claim was locked: ${update.fact}`);
      }
      nextCount = update.nextValue;
    }
    return nextCount;
  }
}
