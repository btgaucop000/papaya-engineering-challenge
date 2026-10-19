import type { Actor, CounterUpdate } from "../workflow/index.js";

export type RequiredDocument = {
  readonly type: string;
  readonly required: boolean;
  readonly present: boolean;
  readonly valid: boolean;
};

export type ClaimRecord = {
  readonly id: string;
  readonly state: string;
  readonly amount: number;
  readonly policyLimit: number;
  readonly requiredDocuments: readonly RequiredDocument[];
  readonly assessorId: string | null;
  readonly assessmentReport: Readonly<Record<string, unknown>> | null;
  readonly assessmentReportComplete: boolean;
  readonly assessmentStartedAt: Date | null;
  readonly informationRequestCount: number;
  readonly currentInformationRequestSequence: number | null;
  readonly currentInformationRequestDescription: string | null;
  readonly rejectionReason: string | null;
  readonly appealExpiresAt: Date | null;
  readonly memberAcknowledgedRejection: boolean;
  readonly archivedAt: Date | null;
  readonly auditSequence: number;
};

export type CreateClaimInput = {
  readonly id: string;
  readonly state?: string;
  readonly amount: number;
  readonly policyLimit: number;
  readonly requiredDocuments?: readonly RequiredDocument[];
  readonly assessorId?: string | null;
  readonly assessmentReport?: Readonly<Record<string, unknown>> | null;
  readonly assessmentReportComplete?: boolean;
  readonly informationRequestCount?: number;
};

export type PaymentRequestRecord = {
  readonly id: string;
  readonly claimId: string;
  readonly amount: number;
  readonly status: "REQUESTED" | "INITIATED";
  readonly confirmed: boolean;
  readonly paymentReference: string | null;
};

export type AuditRecord = {
  readonly claimId: string;
  readonly sequence: number;
  readonly occurredAt: Date;
  readonly fromState: string;
  readonly toState: string;
  readonly transitionId: string;
  readonly triggeredByUserId: string;
  readonly triggeredByRole: string;
  readonly reason: string | null;
};

export type TransitionCommand = {
  readonly claimId: string;
  readonly transitionId: string;
  readonly actor: Actor;
  readonly reason?: string;
  readonly rejectionReason?: string;
  readonly missingInfoDescription?: string;
};

export type EffectWarning = {
  readonly effectType: string;
  readonly message: string;
};

export type PersistedTransition = {
  readonly claimId: string;
  readonly transitionId: string;
  readonly fromState: string;
  readonly toState: string;
  readonly auditSequence: number;
  readonly counterUpdates: readonly CounterUpdate[];
  readonly effectWarnings: readonly EffectWarning[];
};
