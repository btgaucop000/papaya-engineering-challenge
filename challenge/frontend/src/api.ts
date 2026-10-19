export type DemoUser = {
  readonly id: string;
  readonly displayName: string;
  readonly role: string;
};

export type RequiredDocument = {
  readonly type: string;
  readonly required: boolean;
  readonly present: boolean;
  readonly valid: boolean;
};

export type PaymentRequest = {
  readonly id: string;
  readonly amount: number;
  readonly status: "REQUESTED" | "INITIATED";
  readonly confirmed: boolean;
  readonly paymentReference: string | null;
};

export type ClaimSummary = {
  readonly id: string;
  readonly state: string;
  readonly stateLabel: string;
  readonly amount: number;
  readonly policyLimit: number;
  readonly informationRequestCount: number;
};

export type Claim = ClaimSummary & {
  readonly requiredDocuments: readonly RequiredDocument[];
  readonly assessorId: string | null;
  readonly assessmentReport: Readonly<Record<string, unknown>> | null;
  readonly assessmentReportComplete: boolean;
  readonly assessmentStartedAt: string | null;
  readonly currentInformationRequestSequence: number | null;
  readonly currentInformationRequestDescription: string | null;
  readonly rejectionReason: string | null;
  readonly appealExpiresAt: string | null;
  readonly memberAcknowledgedRejection: boolean;
  readonly archivedAt: string | null;
  readonly auditSequence: number;
  readonly paymentRequest: PaymentRequest | null;
};

export type ConditionFailure = {
  readonly code: "CONDITION_NOT_MET" | "FACT_MISSING";
  readonly fact?: string;
  readonly message: string;
};

export type TransitionPreview = {
  readonly transitionId: string;
  readonly transitionLabel: string;
  readonly fromState: string;
  readonly fromStateLabel: string;
  readonly toState: string;
  readonly toStateLabel: string;
  readonly requiredRoles: readonly string[];
  readonly authorized: boolean;
  readonly available: boolean;
  readonly unmetConditions: readonly ConditionFailure[];
};

export type AuditEntry = {
  readonly claimId: string;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly fromState: string;
  readonly fromStateLabel: string;
  readonly toState: string;
  readonly toStateLabel: string;
  readonly transitionId: string;
  readonly transitionLabel: string;
  readonly triggeredByUserId: string;
  readonly triggeredByRole: string;
  readonly reason: string | null;
};

export type EffectWarning = {
  readonly effectType: string;
  readonly message: string;
};

export type TransitionResult = {
  readonly claimId: string;
  readonly transitionId: string;
  readonly fromState: string;
  readonly toState: string;
  readonly auditSequence: number;
  readonly effectWarnings: readonly EffectWarning[];
};

type ErrorBody = {
  readonly code?: unknown;
  readonly message?: unknown;
  readonly details?: unknown;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  userId?: string,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  if (userId !== undefined) {
    headers.set("x-demo-user-id", userId);
  }

  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...options, headers });
  } catch (error) {
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      "The API could not be reached. Check that the backend is running.",
      error instanceof Error ? error.message : String(error),
    );
  }

  const text = await response.text();
  let body: unknown = null;
  if (text !== "") {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    const errorBody = typeof body === "object" && body !== null ? (body as ErrorBody) : {};
    throw new ApiError(
      response.status,
      typeof errorBody.code === "string" ? errorBody.code : `HTTP_${response.status}`,
      typeof errorBody.message === "string" ? errorBody.message : response.statusText,
      errorBody.details,
    );
  }

  return body as T;
}

export const api = {
  listUsers: () => request<readonly DemoUser[]>("/demo-users"),
  listClaims: () => request<readonly ClaimSummary[]>("/claims"),
  getClaim: (claimId: string) => request<Claim>(`/claims/${claimId}`),
  getTransitions: (claimId: string, userId: string) =>
    request<readonly TransitionPreview[]>(`/claims/${claimId}/transitions`, {}, userId),
  getAudit: (claimId: string) => request<readonly AuditEntry[]>(`/claims/${claimId}/audit`),
  setDocuments: (claimId: string, userId: string, documents: readonly RequiredDocument[]) =>
    request<Claim>(
      `/claims/${claimId}/documents`,
      { method: "PUT", body: JSON.stringify({ documents }) },
      userId,
    ),
  assignAssessor: (claimId: string, userId: string, assessorId: string) =>
    request<Claim>(
      `/claims/${claimId}/assessor`,
      { method: "PUT", body: JSON.stringify({ assessorId }) },
      userId,
    ),
  completeAssessment: (
    claimId: string,
    userId: string,
    report: Readonly<Record<string, unknown>>,
  ) =>
    request<Claim>(
      `/claims/${claimId}/assessment-report`,
      { method: "PUT", body: JSON.stringify({ report }) },
      userId,
    ),
  recordAdditionalInformation: (
    claimId: string,
    userId: string,
    isValid: boolean,
    metadata: Readonly<Record<string, unknown>>,
  ) =>
    request<{ readonly claimId: string; readonly requestSequence: number }>(
      `/claims/${claimId}/additional-information`,
      { method: "POST", body: JSON.stringify({ isValid, metadata }) },
      userId,
    ),
  confirmPayment: (claimId: string, userId: string, paymentReference: string) =>
    request<Claim>(
      `/claims/${claimId}/payment-confirmation`,
      { method: "PUT", body: JSON.stringify({ paymentReference }) },
      userId,
    ),
  transition: (
    claimId: string,
    userId: string,
    input: {
      readonly transitionId: string;
      readonly reason?: string;
      readonly rejectionReason?: string;
      readonly missingInfoDescription?: string;
    },
  ) =>
    request<TransitionResult>(
      `/claims/${claimId}/transitions`,
      { method: "POST", body: JSON.stringify(input) },
      userId,
    ),
  acknowledgeRejection: (claimId: string) =>
    request(`/claims/${claimId}/member-acknowledgement`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  runSystemAction: (claimId: string) =>
    request<TransitionResult>(`/claims/${claimId}/system-actions/run`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
};
