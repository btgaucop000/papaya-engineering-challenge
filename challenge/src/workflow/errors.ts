import type { ConditionFailure } from "./types.js";

export class WorkflowConfigError extends Error {
  readonly code = "INVALID_WORKFLOW_CONFIG";

  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = "WorkflowConfigError";
  }
}

export class InvalidTransitionError extends Error {
  readonly code = "INVALID_TRANSITION";

  constructor(
    readonly currentState: string,
    readonly transitionId: string,
    readonly allowedTransitionIds: readonly string[],
  ) {
    const allowed = allowedTransitionIds.length > 0 ? allowedTransitionIds.join(", ") : "none";
    super(
      `Transition "${transitionId}" is not available from state "${currentState}". Allowed transitions: ${allowed}`,
    );
    this.name = "InvalidTransitionError";
  }
}

export class UnauthorizedRoleError extends Error {
  readonly code = "UNAUTHORIZED_ROLE";

  constructor(
    readonly transitionId: string,
    readonly actualRole: string,
    readonly requiredRoles: readonly string[],
  ) {
    super(
      `Role "${actualRole}" cannot execute transition "${transitionId}". Required roles: ${requiredRoles.join(", ")}`,
    );
    this.name = "UnauthorizedRoleError";
  }
}

export class PreconditionsFailedError extends Error {
  readonly code = "PRECONDITION_FAILED";

  constructor(
    readonly transitionId: string,
    readonly failures: readonly ConditionFailure[],
  ) {
    super(
      `Preconditions failed for transition "${transitionId}": ${failures.map((failure) => failure.message).join("; ")}`,
    );
    this.name = "PreconditionsFailedError";
  }
}

export class CycleLimitExceededError extends Error {
  readonly code = "CYCLE_LIMIT_EXCEEDED";

  constructor(
    readonly transitionId: string,
    readonly currentCount: number,
    readonly maximum: number,
    message: string,
  ) {
    super(message);
    this.name = "CycleLimitExceededError";
  }
}
