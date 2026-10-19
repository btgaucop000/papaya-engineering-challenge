export class ClaimNotFoundError extends Error {
  readonly code = "CLAIM_NOT_FOUND";

  constructor(readonly claimId: string) {
    super(`Claim not found: ${claimId}`);
    this.name = "ClaimNotFoundError";
  }
}

export class InvalidPrerequisiteStateError extends Error {
  readonly code = "INVALID_PREREQUISITE_STATE";

  constructor(
    readonly operation: string,
    readonly currentState: string,
    readonly allowedStates: readonly string[],
  ) {
    super(
      `Operation "${operation}" is not available in state "${currentState}". Allowed states: ${allowedStates.join(", ")}`,
    );
    this.name = "InvalidPrerequisiteStateError";
  }
}

export class AssignedAssessorMismatchError extends Error {
  readonly code = "ASSIGNED_ASSESSOR_MISMATCH";

  constructor(
    readonly assignedAssessorId: string | null,
    readonly actualAssessorId: string,
  ) {
    super(
      assignedAssessorId === null
        ? "An assessor must be assigned before completing an assessment report"
        : `Assessor "${actualAssessorId}" is not assigned to this claim`,
    );
    this.name = "AssignedAssessorMismatchError";
  }
}

export class PaymentRequestNotReadyError extends Error {
  readonly code = "PAYMENT_REQUEST_NOT_READY";

  constructor(readonly claimId: string) {
    super(`An initiated payment request was not found for claim: ${claimId}`);
    this.name = "PaymentRequestNotReadyError";
  }
}
