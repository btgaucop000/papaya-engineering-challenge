import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

import type {
  CounterUpdate,
  EffectDescriptor,
  FactContext,
  WorkflowDefinition,
} from "../workflow/index.js";
import { readFact } from "../workflow/index.js";
import type { ClaimRecord, TransitionCommand } from "./types.js";

export type TransactionalEffectContext = {
  readonly client: PoolClient;
  readonly claim: ClaimRecord;
  readonly command: TransitionCommand;
  readonly facts: FactContext;
  readonly counterUpdates: readonly CounterUpdate[];
  readonly now: Date;
  readonly settings: WorkflowDefinition["settings"];
};

export type TransactionalEffectHandler = (
  effect: EffectDescriptor,
  context: TransactionalEffectContext,
) => Promise<void>;

export type AfterCommitEffectHandler = (
  effect: EffectDescriptor,
  context: Omit<TransactionalEffectContext, "client">,
) => Promise<void>;

function requiredCommandText(value: string | undefined, field: string): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`Transactional effect requires command field: ${field}`);
  }
  return value;
}

export function createTransactionalEffectHandlers(): Readonly<
  Record<string, TransactionalEffectHandler>
> {
  return {
    start_assessment_timer: async (_effect, context) => {
      await context.client.query(
        "UPDATE claims SET assessment_started_at = $2 WHERE id = $1",
        [context.claim.id, context.now],
      );
    },
    reset_assessment_timer: async (_effect, context) => {
      await context.client.query(
        "UPDATE claims SET assessment_started_at = NULL WHERE id = $1",
        [context.claim.id],
      );
    },
    record_information_request: async (_effect, context) => {
      const description = requiredCommandText(
        context.command.missingInfoDescription,
        "missingInfoDescription",
      );
      const counter = context.counterUpdates.find(
        (update) => update.fact === "workflow.informationRequestCount",
      );
      if (counter === undefined) {
        throw new Error("Information request effect requires its configured counter update");
      }
      await context.client.query(
        `UPDATE claims SET current_information_request_sequence = $2,
           current_information_request_description = $3,
           assessment_report_complete = false
         WHERE id = $1`,
        [context.claim.id, counter.nextValue, description],
      );
    },
    record_rejection: async (_effect, context) => {
      const rejectionReason = requiredCommandText(
        context.command.rejectionReason,
        "rejectionReason",
      );
      const appealExpiresAt = new Date(
        context.now.getTime() + context.settings.appealPeriodDays * 24 * 60 * 60 * 1000,
      );
      await context.client.query(
        `UPDATE claims SET rejection_reason = $2, appeal_expires_at = $3
         WHERE id = $1`,
        [context.claim.id, rejectionReason, appealExpiresAt],
      );
    },
    create_payment_request: async (_effect, context) => {
      await context.client.query(
        `INSERT INTO payment_requests
           (id, claim_id, amount, status, created_at)
         VALUES ($1, $2, $3, 'REQUESTED', $4)`,
        [randomUUID(), context.claim.id, context.claim.amount, context.now],
      );
    },
    mark_payment_initiated: async (_effect, context) => {
      const result = await context.client.query(
        `UPDATE payment_requests SET status = 'INITIATED', initiated_at = $2
         WHERE claim_id = $1 AND status = 'REQUESTED'`,
        [context.claim.id, context.now],
      );
      if (result.rowCount !== 1) {
        throw new Error(`Payment request is not ready for claim: ${context.claim.id}`);
      }
    },
    archive_claim: async (_effect, context) => {
      await context.client.query("UPDATE claims SET archived_at = $2 WHERE id = $1", [
        context.claim.id,
        context.now,
      ]);
    },
  };
}

export class TransactionalEffectRegistry {
  constructor(
    private readonly handlers: Readonly<Record<string, TransactionalEffectHandler>> =
      createTransactionalEffectHandlers(),
  ) {}

  async execute(effect: EffectDescriptor, context: TransactionalEffectContext): Promise<void> {
    const handler = this.handlers[effect.type];
    if (handler === undefined) {
      throw new Error(`No transactional handler registered for effect: ${effect.type}`);
    }
    await handler(effect, context);
  }
}

export function createLoggingAfterCommitHandlers(
  log: (message: string) => void = console.log,
): Readonly<Record<string, AfterCommitEffectHandler>> {
  const mockHandler: AfterCommitEffectHandler = async (effect, context) => {
    const template = effect.args.template;
    const details: Record<string, unknown> = {};
    if (template === "claim_rejected") {
      details.rejectionReason = context.command.rejectionReason;
      details.appealInstructions = "Contact the claims team within the configured appeal period.";
    } else if (template === "additional_information_requested") {
      details.missingInfoDescription = context.command.missingInfoDescription;
    } else if (template === "payment_confirmed") {
      details.paymentReference = readFact(context.facts, "payment.reference");
    }
    log(
      JSON.stringify({
        kind: "mock-effect",
        type: effect.type,
        claimId: context.claim.id,
        args: effect.args,
        details,
      }),
    );
  };
  return {
    notify_assessor_team: mockHandler,
    notify_member: mockHandler,
    invoke_payment_system: mockHandler,
  };
}

export class AfterCommitEffectRegistry {
  constructor(
    private readonly handlers: Readonly<Record<string, AfterCommitEffectHandler>> =
      createLoggingAfterCommitHandlers(),
  ) {}

  async execute(
    effect: EffectDescriptor,
    context: Omit<TransactionalEffectContext, "client">,
  ): Promise<void> {
    const handler = this.handlers[effect.type];
    if (handler === undefined) {
      throw new Error(`No after-commit handler registered for effect: ${effect.type}`);
    }
    await handler(effect, context);
  }
}
