import type { Pool, PoolClient } from "pg";

import type {
  Actor,
  FactContext,
  TransitionPlan,
  WorkflowDefinition,
  WorkflowEngine,
} from "../workflow/index.js";
import { evaluateCondition, readFact } from "../workflow/index.js";
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
  TransitionPreview,
} from "./types.js";
import { ClaimNotFoundError } from "./errors.js";

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
    let facts: FactContext;

    try {
      await client.query("BEGIN");
      const repository = new ClaimRepository(client);

      const lockedClaim = await repository.lockById(command.claimId);
      if (lockedClaim === null) {
        throw new ClaimNotFoundError(command.claimId);
      }
      claim = lockedClaim;
      await this.hooks.afterClaimLocked?.(client, claim);

      facts = await this.buildFacts(repository, claim, command);
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
          facts,
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
          facts,
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

  async previewTransitions(claimId: string, actor: Actor): Promise<readonly TransitionPreview[]> {
    const repository = new ClaimRepository(this.pool);
    const claim = await repository.findById(claimId);
    if (claim === null) {
      throw new ClaimNotFoundError(claimId);
    }

    const facts = await this.buildFacts(repository, claim, {
      claimId,
      transitionId: "preview",
      actor,
    });

    return this.engine.listTransitions(claim.state).map((transition) => {
      const evaluation = evaluateCondition(transition.precondition, facts);
      const unmetConditions = [...evaluation.failures];

      for (const limit of this.definition.cycleLimits) {
        if (limit.transitionId !== transition.id) {
          continue;
        }
        const count = readFact(facts, limit.counterFact);
        if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
          unmetConditions.push({
            code: "FACT_MISSING",
            fact: limit.counterFact,
            message: `Fact "${limit.counterFact}" must be a non-negative integer`,
          });
        } else if (count >= limit.max) {
          unmetConditions.push({
            code: "CONDITION_NOT_MET",
            fact: limit.counterFact,
            message: limit.errorMessage,
          });
        }
      }

      const authorized = transition.roles.includes(actor.role);
      return {
        transitionId: transition.id,
        fromState: transition.from,
        toState: transition.to,
        requiredRoles: transition.roles,
        authorized,
        available: authorized && unmetConditions.length === 0,
        unmetConditions,
      };
    });
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
