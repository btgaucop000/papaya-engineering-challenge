import {
  CycleLimitExceededError,
  InvalidTransitionError,
  PreconditionsFailedError,
  UnauthorizedRoleError,
} from "./errors.js";
import { defaultRegistries } from "./registries.js";
import type {
  Condition,
  ConditionFailure,
  FactContext,
  LeafCondition,
  TransitionPlan,
  TransitionRequest,
  WorkflowDefinition,
  WorkflowRegistries,
  WorkflowTransition,
} from "./types.js";

type EvaluationResult =
  | { readonly status: "passed"; readonly failures: readonly [] }
  | { readonly status: "failed" | "missing"; readonly failures: readonly ConditionFailure[] };

const passed = (): EvaluationResult => ({ status: "passed", failures: [] });

const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

export function readFact(facts: FactContext, path: string): unknown {
  if (hasOwn(facts, path)) {
    return facts[path];
  }

  let current: unknown = facts;
  for (const segment of path.split(".")) {
    if (typeof current !== "object" || current === null || !hasOwn(current, segment)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function isLeaf(condition: Condition): condition is LeafCondition {
  return "fact" in condition;
}

function evaluateLeaf(
  condition: LeafCondition,
  facts: FactContext,
  registries: WorkflowRegistries,
): EvaluationResult {
  const left = readFact(facts, condition.fact);
  if (left === undefined || left === null) {
    return {
      status: "missing",
      failures: [
        {
          code: "FACT_MISSING",
          fact: condition.fact,
          message: `Fact "${condition.fact}" is missing: ${condition.description}`,
        },
      ],
    };
  }

  const operator = registries.operators[condition.operator];
  if (operator === undefined) {
    // Definitions are validated on load. This remains fail-closed for callers that
    // construct a WorkflowDefinition without the loader.
    return {
      status: "failed",
      failures: [
        {
          code: "CONDITION_NOT_MET",
          fact: condition.fact,
          message: `Operator "${condition.operator}" is not registered`,
        },
      ],
    };
  }

  let right: unknown;
  if (operator.operand === "literal") {
    right = condition.value;
  } else if (operator.operand === "fact") {
    const rightPath = condition.valueFromFact;
    right = rightPath === undefined ? undefined : readFact(facts, rightPath);
    if (right === undefined || right === null) {
      return {
        status: "missing",
        failures: [
          {
            code: "FACT_MISSING",
            ...(rightPath === undefined ? {} : { fact: rightPath }),
            message:
              rightPath === undefined
                ? `Comparison fact is missing: ${condition.description}`
                : `Fact "${rightPath}" is missing: ${condition.description}`,
          },
        ],
      };
    }
  }

  if (operator.evaluate(left, right)) {
    return passed();
  }

  return {
    status: "failed",
    failures: [
      {
        code: "CONDITION_NOT_MET",
        fact: condition.fact,
        message: condition.description,
      },
    ],
  };
}

export function evaluateCondition(
  condition: Condition,
  facts: FactContext,
  registries: WorkflowRegistries = defaultRegistries,
): EvaluationResult {
  if (isLeaf(condition)) {
    return evaluateLeaf(condition, facts, registries);
  }

  if ("all" in condition) {
    const results = condition.all.map((child) => evaluateCondition(child, facts, registries));
    const failures = results.flatMap((result) => result.failures);
    if (failures.length === 0) {
      return passed();
    }
    return {
      status: results.some((result) => result.status === "missing") ? "missing" : "failed",
      failures,
    };
  }

  if ("any" in condition) {
    const results = condition.any.map((child) => evaluateCondition(child, facts, registries));
    if (results.some((result) => result.status === "passed")) {
      return passed();
    }
    return {
      status: results.some((result) => result.status === "missing") ? "missing" : "failed",
      failures: results.flatMap((result) => result.failures),
    };
  }

  const result = evaluateCondition(condition.not, facts, registries);
  if (result.status === "missing") {
    return result;
  }
  if (result.status === "failed") {
    return passed();
  }
  return {
    status: "failed",
    failures: [
      {
        code: "CONDITION_NOT_MET",
        message: "Negated condition was satisfied",
      },
    ],
  };
}

export class WorkflowEngine {
  constructor(
    private readonly definition: WorkflowDefinition,
    private readonly registries: WorkflowRegistries = defaultRegistries,
  ) {}

  listTransitions(currentState: string): readonly WorkflowTransition[] {
    return this.definition.transitions.filter((transition) => transition.from === currentState);
  }

  planTransition(request: TransitionRequest): TransitionPlan {
    const outgoing = this.listTransitions(request.currentState);
    const transition = outgoing.find((candidate) => candidate.id === request.transitionId);

    if (transition === undefined) {
      throw new InvalidTransitionError(
        request.currentState,
        request.transitionId,
        outgoing.map((candidate) => candidate.id),
      );
    }

    if (!transition.roles.includes(request.actor.role)) {
      throw new UnauthorizedRoleError(transition.id, request.actor.role, transition.roles);
    }

    const counterUpdates = this.definition.cycleLimits
      .filter((limit) => limit.transitionId === transition.id)
      .map((limit) => {
        const rawCount = readFact(request.facts, limit.counterFact);
        if (typeof rawCount !== "number" || !Number.isInteger(rawCount) || rawCount < 0) {
          throw new PreconditionsFailedError(transition.id, [
            {
              code: "FACT_MISSING",
              fact: limit.counterFact,
              message: `Fact "${limit.counterFact}" must be a non-negative integer`,
            },
          ]);
        }
        if (rawCount >= limit.max) {
          throw new CycleLimitExceededError(transition.id, rawCount, limit.max, limit.errorMessage);
        }
        return {
          fact: limit.counterFact,
          previousValue: rawCount,
          nextValue: rawCount + 1,
        };
      });

    const evaluation = evaluateCondition(transition.precondition, request.facts, this.registries);
    if (evaluation.status !== "passed") {
      throw new PreconditionsFailedError(transition.id, evaluation.failures);
    }

    return {
      workflowId: this.definition.id,
      transitionId: transition.id,
      fromState: transition.from,
      toState: transition.to,
      actor: { ...request.actor },
      ...(request.reason === undefined ? {} : { reason: request.reason }),
      counterUpdates,
      transactionalEffects: transition.effects.filter((effect) => effect.phase === "transactional"),
      afterCommitEffects: transition.effects.filter((effect) => effect.phase === "afterCommit"),
    };
  }
}
