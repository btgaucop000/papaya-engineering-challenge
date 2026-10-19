# Required Scenario Evidence — 2026-10-20 (UTC+07:00)

## Execution

- Command: `npm run verify:scenarios`
- Exit code: `0`
- Database: real PostgreSQL database `claims_workflow_test`
- Workflow: unchanged `challenge/config/claims-workflow.json`
- Safety: the runner verifies `current_database()` ends in `_test`; it creates one UUID claim per scenario and does not query or mutate the development database.
- Assertions: the command exits non-zero unless every expected state, counter, audit count/order, error code/message, and failure snapshot is correct.

The successful run completed at `2026-10-20T00:57:42.565+07:00` (`2026-10-19T17:57:42.565Z`). A later integration-test setup may truncate the shared test database; the output below is the captured result from the actual successful scenario run.

## Summary

| ID | Claim ID | Asserted result |
|---|---|---|
| `SC-01` | `3884f96a-c9ed-4033-ae96-76e47f7b6cef` | `CLOSED`; 5 audit records; counter 0; payment `PAY-HAPPY-001` |
| `SC-02` | `634a849c-6548-4c1a-b2c5-e181a79841d4` | `CLOSED`; 4 audit records; counter 0 |
| `SC-03` | `c5b5b6f1-be89-47e7-a3fd-e80a4ea92021` | `CLOSED`; 8 audit records; counter 1; information bound to request 1; payment `PAY-INFO-001` |
| `SC-04` | `fc2bbe40-5b1b-4cb6-bc0c-50cec0c7a401` | `INVALID_TRANSITION`; remained `SUBMITTED`; 0 audit records; persisted snapshot and effects unchanged |
| `SC-05` | `5d23a75e-13f9-49f1-b5ba-8ca425ee6ae2` | `UNAUTHORIZED_ROLE`; remained `SUBMITTED`; 0 audit records; persisted snapshot and effects unchanged |

## SC-01 — Happy path audit

Claim `3884f96a-c9ed-4033-ae96-76e47f7b6cef`, final state `CLOSED`, 5 records.

| Seq | Timestamp (UTC) | From → To | Transition | Actor / role | Notes |
|---:|---|---|---|---|---|
| 1 | `2026-10-19T17:57:42.415Z` | `SUBMITTED` → `DOCUMENTS_VERIFIED` | `verify_documents` | `demo-document-clerk` / `document_clerk` | Required scenario: documents verified |
| 2 | `2026-10-19T17:57:42.425Z` | `DOCUMENTS_VERIFIED` → `UNDER_ASSESSMENT` | `start_assessment` | `demo-team-lead` / `team_lead` | Required scenario: assessment started |
| 3 | `2026-10-19T17:57:42.434Z` | `UNDER_ASSESSMENT` → `APPROVED` | `approve_claim` | `demo-assessor` / `assessor` | Required scenario: claim approved |
| 4 | `2026-10-19T17:57:42.441Z` | `APPROVED` → `PAYMENT_INITIATED` | `initiate_payment` | `demo-finance` / `finance` | Required scenario: payment initiated |
| 5 | `2026-10-19T17:57:42.449Z` | `PAYMENT_INITIATED` → `CLOSED` | `close_paid_claim` | `demo-finance` / `finance` | Required scenario: confirmed payment closed |

## SC-02 — Rejection path audit

Claim `634a849c-6548-4c1a-b2c5-e181a79841d4`, final state `CLOSED`, 4 records.

| Seq | Timestamp (UTC) | From → To | Transition | Actor / role | Notes |
|---:|---|---|---|---|---|
| 1 | `2026-10-19T17:57:42.459Z` | `SUBMITTED` → `DOCUMENTS_VERIFIED` | `verify_documents` | `demo-document-clerk` / `document_clerk` | Required scenario: documents verified |
| 2 | `2026-10-19T17:57:42.466Z` | `DOCUMENTS_VERIFIED` → `UNDER_ASSESSMENT` | `start_assessment` | `demo-team-lead` / `team_lead` | Required scenario: assessment started |
| 3 | `2026-10-19T17:57:42.474Z` | `UNDER_ASSESSMENT` → `REJECTED` | `reject_claim` | `demo-assessor` / `assessor` | Required scenario: claim rejected |
| 4 | `2026-10-19T17:57:42.483Z` | `REJECTED` → `CLOSED` | `close_rejected_claim` | `demo-system` / `system` | Required scenario: acknowledged rejection closed |

The captured mock rejection notification included `Policy exclusion applies` and the configured appeal instructions.

## SC-03 — Request-information loop audit

Claim `c5b5b6f1-be89-47e7-a3fd-e80a4ea92021`, final state `CLOSED`, counter `1`, 8 records.

| Seq | Timestamp (UTC) | From → To | Transition | Actor / role | Notes |
|---:|---|---|---|---|---|
| 1 | `2026-10-19T17:57:42.492Z` | `SUBMITTED` → `DOCUMENTS_VERIFIED` | `verify_documents` | `demo-document-clerk` / `document_clerk` | Required scenario: documents verified |
| 2 | `2026-10-19T17:57:42.500Z` | `DOCUMENTS_VERIFIED` → `UNDER_ASSESSMENT` | `start_assessment` | `demo-team-lead` / `team_lead` | Required scenario: assessment started |
| 3 | `2026-10-19T17:57:42.505Z` | `UNDER_ASSESSMENT` → `PENDING_INFO` | `request_more_info` | `demo-assessor` / `assessor` | Required scenario: additional information requested |
| 4 | `2026-10-19T17:57:42.515Z` | `PENDING_INFO` → `DOCUMENTS_VERIFIED` | `receive_additional_info` | `demo-document-clerk` / `document_clerk` | Required scenario: additional information received |
| 5 | `2026-10-19T17:57:42.521Z` | `DOCUMENTS_VERIFIED` → `UNDER_ASSESSMENT` | `start_assessment` | `demo-team-lead` / `team_lead` | Required scenario: reassessment started |
| 6 | `2026-10-19T17:57:42.531Z` | `UNDER_ASSESSMENT` → `APPROVED` | `approve_claim` | `demo-assessor` / `assessor` | Required scenario: claim approved |
| 7 | `2026-10-19T17:57:42.537Z` | `APPROVED` → `PAYMENT_INITIATED` | `initiate_payment` | `demo-finance` / `finance` | Required scenario: payment initiated |
| 8 | `2026-10-19T17:57:42.546Z` | `PAYMENT_INITIATED` → `CLOSED` | `close_paid_claim` | `demo-finance` / `finance` | Required scenario: confirmed payment closed |

The prerequisite operation returned request sequence `1`, and the runner asserted that value before continuing.

## SC-04 — Invalid transition output

```json
{
  "claimId": "fc2bbe40-5b1b-4cb6-bc0c-50cec0c7a401",
  "code": "INVALID_TRANSITION",
  "message": "Transition \"approve_claim\" is not available from state \"SUBMITTED\". Allowed transitions: verify_documents",
  "finalState": "SUBMITTED",
  "auditCount": 0,
  "unchangedAfterFailure": true
}
```

## SC-05 — Wrong-role output

```json
{
  "claimId": "5d23a75e-13f9-49f1-b5ba-8ca425ee6ae2",
  "code": "UNAUTHORIZED_ROLE",
  "message": "Role \"finance\" cannot execute transition \"verify_documents\". Required roles: document_clerk",
  "finalState": "SUBMITTED",
  "auditCount": 0,
  "unchangedAfterFailure": true
}
```
