import assert from "node:assert/strict";
import { resolve } from "node:path";
import { before, describe, test } from "node:test";

import {
  CycleLimitExceededError,
  InvalidTransitionError,
  loadWorkflowDefinition,
  PreconditionsFailedError,
  UnauthorizedRoleError,
  WorkflowEngine,
} from "../src/workflow/index.js";
import type { FactContext, TransitionRequest } from "../src/workflow/index.js";

let engine: WorkflowEngine;

before(async () => {
  const definition = await loadWorkflowDefinition(resolve("challenge/config/claims-workflow.json"));
  engine = new WorkflowEngine(definition);
});

const request = (
  currentState: string,
  transitionId: string,
  role: string,
  facts: FactContext,
): TransitionRequest => ({
  currentState,
  transitionId,
  actor: { userId: `demo-${role}`, role },
  facts,
});

describe("workflow engine transition validation", () => {
  test("returns a plan for a valid transition without executing effects", () => {
    const plan = engine.planTransition(
      request("SUBMITTED", "verify_documents", "document_clerk", {
        documents: { allRequiredPresentValid: true },
      }),
    );

    assert.equal(plan.fromState, "SUBMITTED");
    assert.equal(plan.toState, "DOCUMENTS_VERIFIED");
    assert.equal(plan.transactionalEffects.length, 0);
    assert.deepEqual(
      plan.afterCommitEffects.map((effect) => effect.type),
      ["notify_assessor_team"],
    );
  });

  test("rejects an invalid transition and lists allowed transitions", () => {
    assert.throws(
      () =>
        engine.planTransition(request("SUBMITTED", "approve_claim", "assessor", {})),
      (error: unknown) => {
        assert.ok(error instanceof InvalidTransitionError);
        assert.equal(error.code, "INVALID_TRANSITION");
        assert.deepEqual(error.allowedTransitionIds, ["verify_documents"]);
        assert.match(error.message, /SUBMITTED/);
        return true;
      },
    );
  });

  test("rejects a valid transition when the actor role is unauthorized", () => {
    assert.throws(
      () =>
        engine.planTransition(
          request("SUBMITTED", "verify_documents", "assessor", {
            documents: { allRequiredPresentValid: true },
          }),
        ),
      (error: unknown) => {
        assert.ok(error instanceof UnauthorizedRoleError);
        assert.equal(error.code, "UNAUTHORIZED_ROLE");
        assert.deepEqual(error.requiredRoles, ["document_clerk"]);
        return true;
      },
    );
  });

  test("returns a specific failed-condition reason", () => {
    assert.throws(
      () =>
        engine.planTransition(
          request("DOCUMENTS_VERIFIED", "start_assessment", "team_lead", {
            assessment: { assessorAssigned: false },
          }),
        ),
      (error: unknown) => {
        assert.ok(error instanceof PreconditionsFailedError);
        assert.equal(error.failures[0]?.message, "An assessor must be assigned");
        return true;
      },
    );
  });
});

describe("amount limit conditions", () => {
  test("allows an amount below the policy limit", () => {
    const plan = engine.planTransition(
      request("UNDER_ASSESSMENT", "approve_claim", "assessor", {
        assessment: { reportComplete: true },
        claim: { amount: 999 },
        policy: { limit: 1000 },
      }),
    );

    assert.equal(plan.toState, "APPROVED");
  });

  test("allows an amount equal to the policy limit", () => {
    const plan = engine.planTransition(
      request("UNDER_ASSESSMENT", "approve_claim", "assessor", {
        assessment: { reportComplete: true },
        claim: { amount: 1000 },
        policy: { limit: 1000 },
      }),
    );

    assert.equal(plan.toState, "APPROVED");
    assert.deepEqual(
      plan.transactionalEffects.map((effect) => effect.type),
      ["create_payment_request"],
    );
  });

  test("rejects an amount above the policy limit", () => {
    assert.throws(
      () =>
        engine.planTransition(
          request("UNDER_ASSESSMENT", "approve_claim", "assessor", {
            assessment: { reportComplete: true },
            claim: { amount: 1001 },
            policy: { limit: 1000 },
          }),
        ),
      (error: unknown) => {
        assert.ok(error instanceof PreconditionsFailedError);
        assert.match(error.message, /must not exceed the policy limit/);
        return true;
      },
    );
  });
});

describe("missing facts and boolean aggregation", () => {
  test("fails closed for a missing fact in an all expression", () => {
    assert.throws(
      () =>
        engine.planTransition(
          request("UNDER_ASSESSMENT", "approve_claim", "assessor", {
            assessment: { reportComplete: true },
            policy: { limit: 1000 },
          }),
        ),
      (error: unknown) => {
        assert.ok(error instanceof PreconditionsFailedError);
        assert.equal(error.failures[0]?.code, "FACT_MISSING");
        assert.equal(error.failures[0]?.fact, "claim.amount");
        return true;
      },
    );
  });

  test("reports both false and missing branches when all branches fail", () => {
    assert.throws(
      () =>
        engine.planTransition(
          request("UNDER_ASSESSMENT", "approve_claim", "assessor", {
            assessment: { reportComplete: false },
            policy: { limit: 1000 },
          }),
        ),
      (error: unknown) => {
        assert.ok(error instanceof PreconditionsFailedError);
        assert.equal(error.failures.length, 2);
        assert.deepEqual(
          error.failures.map((failure) => failure.code),
          ["CONDITION_NOT_MET", "FACT_MISSING"],
        );
        return true;
      },
    );
  });

  test("allows any when one branch is true and another fact is missing", () => {
    const plan = engine.planTransition(
      request("REJECTED", "close_rejected_claim", "system", {
        rejection: { memberAcknowledged: true },
      }),
    );

    assert.equal(plan.toState, "CLOSED");
  });

  test("fails any when one branch is false and the other fact is missing", () => {
    assert.throws(
      () =>
        engine.planTransition(
          request("REJECTED", "close_rejected_claim", "system", {
            rejection: { memberAcknowledged: false },
          }),
        ),
      (error: unknown) => {
        assert.ok(error instanceof PreconditionsFailedError);
        assert.equal(error.failures.length, 2);
        assert.ok(error.failures.some((failure) => failure.code === "FACT_MISSING"));
        return true;
      },
    );
  });

  test("fails when the comparison's right-hand fact is missing", () => {
    assert.throws(
      () =>
        engine.planTransition(
          request("UNDER_ASSESSMENT", "approve_claim", "assessor", {
            assessment: { reportComplete: true },
            claim: { amount: 100 },
          }),
        ),
      (error: unknown) => {
        assert.ok(error instanceof PreconditionsFailedError);
        assert.equal(error.failures[0]?.fact, "policy.limit");
        return true;
      },
    );
  });
});

describe("information request cycle limit", () => {
  const requestInfo = (count: number): TransitionRequest =>
    request("UNDER_ASSESSMENT", "request_more_info", "assessor", {
      command: { missingInfoDescription: "Please provide the original invoice" },
      workflow: { informationRequestCount: count },
    });

  test("increments the counter on the first request", () => {
    const plan = engine.planTransition(requestInfo(0));

    assert.deepEqual(plan.counterUpdates, [
      { fact: "workflow.informationRequestCount", previousValue: 0, nextValue: 1 },
    ]);
  });

  test("allows the third request and plans counter value three", () => {
    const plan = engine.planTransition(requestInfo(2));

    assert.equal(plan.toState, "PENDING_INFO");
    assert.equal(plan.counterUpdates[0]?.nextValue, 3);
  });

  test("rejects the fourth request with the exact required message", () => {
    assert.throws(
      () => engine.planTransition(requestInfo(3)),
      (error: unknown) => {
        assert.ok(error instanceof CycleLimitExceededError);
        assert.equal(error.code, "CYCLE_LIMIT_EXCEEDED");
        assert.equal(error.currentCount, 3);
        assert.equal(
          error.message,
          "Maximum information requests exceeded — escalate to team lead",
        );
        return true;
      },
    );
  });

  test("fails closed when the cycle counter is missing", () => {
    assert.throws(
      () =>
        engine.planTransition(
          request("UNDER_ASSESSMENT", "request_more_info", "assessor", {
            command: { missingInfoDescription: "More evidence needed" },
          }),
        ),
      (error: unknown) => {
        assert.ok(error instanceof PreconditionsFailedError);
        assert.equal(error.failures[0]?.fact, "workflow.informationRequestCount");
        return true;
      },
    );
  });
});

describe("effect planning", () => {
  test("separates transactional and after-commit effects", () => {
    const plan = engine.planTransition(
      request("APPROVED", "initiate_payment", "finance", {
        payment: { requestExists: true },
      }),
    );

    assert.deepEqual(
      plan.transactionalEffects.map((effect) => effect.type),
      ["mark_payment_initiated"],
    );
    assert.deepEqual(
      plan.afterCommitEffects.map((effect) => effect.type),
      ["invoke_payment_system"],
    );
  });

  test("does not mutate the supplied facts", () => {
    const facts = {
      command: { missingInfoDescription: "More evidence needed" },
      workflow: { informationRequestCount: 1 },
    };

    engine.planTransition(request("UNDER_ASSESSMENT", "request_more_info", "assessor", facts));

    assert.deepEqual(facts, {
      command: { missingInfoDescription: "More evidence needed" },
      workflow: { informationRequestCount: 1 },
    });
  });
});
