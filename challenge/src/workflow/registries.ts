import type { WorkflowRegistries } from "./types.js";

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const defaultRegistries: WorkflowRegistries = {
  roles: new Set(["document_clerk", "team_lead", "assessor", "finance", "system"]),
  facts: new Set([
    "documents.allRequiredPresentValid",
    "assessment.assessorAssigned",
    "assessment.reportComplete",
    "claim.amount",
    "policy.limit",
    "command.rejectionReason",
    "command.missingInfoDescription",
    "information.currentRequestHasValidRecord",
    "workflow.informationRequestCount",
    "payment.requestExists",
    "payment.confirmed",
    "payment.reference",
    "appeal.expired",
    "rejection.memberAcknowledged",
  ]),
  operators: {
    eq: {
      operand: "literal",
      evaluate: (left, right) => Object.is(left, right),
    },
    exists: {
      operand: "none",
      evaluate: (left) => left !== null && left !== undefined && left !== "",
    },
    lte: {
      operand: "fact",
      evaluate: (left, right) => isNumber(left) && isNumber(right) && left <= right,
    },
  },
  effects: {
    start_assessment_timer: "transactional",
    reset_assessment_timer: "transactional",
    create_payment_request: "transactional",
    mark_payment_initiated: "transactional",
    archive_claim: "transactional",
    notify_assessor_team: "afterCommit",
    notify_member: "afterCommit",
    invoke_payment_system: "afterCommit",
  },
};
