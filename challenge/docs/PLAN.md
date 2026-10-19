# Challenge 14 Implementation Plan

## Current status

As of 2026-10-19, the validated workflow configuration, pure TypeScript workflow engine, and PostgreSQL persistence increments are implemented. The HTTP API, React UI, and delivery pipeline have not been implemented.

The implemented slices have been verified with the following commands:

- `docker compose up -d postgres`: started a real local PostgreSQL 16 container.
- `npm run db:migrate`: applied the migrations to the development database.
- `npm run test:unit`: 29 unit tests passed, 0 failed.
- `npm run test:integration`: created/migrated the dedicated `claims_workflow_test` database; 8 PostgreSQL integration tests passed, 0 failed.
- `npm run typecheck`: passed.

The five end-to-end scenarios and all API, UI, and config-extension checks remain pending because those increments are outside the current persistence slice.

## Implementation progress

### Completed in the workflow-engine slice

- Added the minimal TypeScript project structure, build/test/typecheck scripts, and development dependencies.
- Added the complete eight-state, nine-transition claims workflow JSON with roles, preconditions, cycle limit, demo appeal duration, and effect descriptors.
- Added startup validation for duplicate identifiers; state, transition, role, fact, operator, and effect references; effect phase ownership; condition operands; and positive cycle limits.
- Added a framework-independent engine that lists outgoing transitions and returns a `TransitionPlan` after transition, role, cycle-limit, and precondition checks.
- Added specific domain errors for invalid transitions, unauthorized roles, failed preconditions, missing facts, and exceeded cycle limits.
- Kept the engine free of database, HTTP, framework, and effect-execution dependencies.
- Added unit coverage for amount below/equal to/above the policy limit, missing facts in `all` and `any`, the fourth information request, config validation, effect planning, and input immutability.

### Completed in the persistence slice

- Added PostgreSQL 16 local infrastructure through Docker Compose, `.env.example`, an idempotent migration runner, and a separate test-database setup command.
- Added claim, prerequisite, request-bound additional-information, mock-payment-request, and ordered audit persistence using `pg`.
- Added an application service that begins a transaction, locks the claim row, reloads database facts, calls the pure engine, and commits state, counters, audit, and configured transactional effects together.
- Added transactional and after-commit effect registries. Persistence contains no transition route table or state-path switch; configured effect descriptors select the handlers.
- Added a restricted runtime database role plus a trigger that rejects audit `UPDATE` and `DELETE`, including attempts made through the migration owner.
- Added real PostgreSQL integration coverage for successful persistence, rejected-transition isolation, audit/effect rollback, audit immutability, row-lock concurrency, payment-effect scoping, and request-sequence-bound prerequisite data.
- Added a cleanup guard that refuses integration-test cleanup unless `current_database()` ends in `_test`.

### Remaining increments

- NestJS API and server-controlled demo identities around the implemented application service and prerequisite operations.
- React UI and all UI verification.
- Required end-to-end scenarios and config-only extension demonstration.
- Final setup, scenario, audit, and extension evidence in the challenge README.

## Purpose and labels

This plan translates the original brief into verifiable implementation increments. It does not replace `REQUIREMENTS.md`.

- **Requirement**: stated by the original challenge.
- **Demo assumption**: an accepted clarification needed to make behavior deterministic.
- **Out of scope**: intentionally excluded from this implementation.

## Scope

### In scope

- NestJS API, React UI, PostgreSQL persistence, and JSON workflow configuration.
- A pure TypeScript workflow engine independent of NestJS and PostgreSQL.
- Config-defined states, transitions, roles, preconditions, cycle limit, and effects.
- Atomic state, counter, audit, and internal-effect persistence.
- Row locking for concurrent transitions.
- Database protection against audit update and deletion.
- Server-controlled demo users and roles.
- Minimal prerequisite-data operations and UI.
- Synchronous mock notifications and payment behavior.
- Five required scenarios, at least 15 tests, and a config-only extension demo.

### Out of scope

- Outbox, queue, durable retries, and retry scheduling.
- A general idempotency framework.
- Workflow versioning, hot reload, and workflow migration.
- Production authentication and authorization infrastructure.
- Real notification, payment, document-storage, or appeal integrations.

## Proposed components

| Component | Responsibility |
|---|---|
| `workflow-engine` | Load validated definitions, list outgoing transitions, evaluate roles and conditions, enforce cycle limits, and return a transition plan. No framework or database imports. |
| NestJS application service | Resolve demo identity, open transactions, lock claims, call the engine, persist changes and audit, run effects, and map domain errors to API errors. |
| PostgreSQL repositories | Persist claims, request-bound information, mock payment requests, and immutable audit rows. |
| React UI | Select a demo user, show claim data, update allowed prerequisite data, show transitions and blocked reasons, execute transitions, and show audit history. |
| JSON workflow definition | Declare workflow states, transitions, roles, conditions, cycle rules, appeal duration, and effect descriptors. |

## Data and operations by workflow step

| Transition | Required data or command input | Transactional changes | After-commit mock effects |
|---|---|---|---|
| `SUBMITTED -> DOCUMENTS_VERIFIED` | All required document records are present and valid. | State and audit. | Notify assessor team. |
| `DOCUMENTS_VERIFIED -> UNDER_ASSESSMENT` | An assessor is assigned. | State, audit, and `assessmentStartedAt = now`. | None. |
| `UNDER_ASSESSMENT -> PENDING_INFO` | Missing-information description supplied with the command. | State, audit, increment `informationRequestCount`, store the request sequence and description, invalidate report completion. | Notify member with request details. |
| `PENDING_INFO -> DOCUMENTS_VERIFIED` | At least one valid information record is bound to the current request sequence. | State, audit, and reset `assessmentStartedAt` to `null`. | None. |
| `UNDER_ASSESSMENT -> APPROVED` | Assessment report complete and claim amount less than or equal to the sample policy limit. | State, audit, and create one mock payment request. | Notify member of approval. |
| `UNDER_ASSESSMENT -> REJECTED` | Assessment report complete and rejection reason supplied. | State, audit, store reason, and calculate `appealExpiresAt` from configured `appealPeriodDays`. | Notify member with reason and appeal instructions. |
| `APPROVED -> PAYMENT_INITIATED` | Mock payment request exists. | State, audit, and mark the request initiated. | Call mock payment system. |
| `PAYMENT_INITIATED -> CLOSED` | Payment confirmed with a reference. | State and audit. | Notify member with payment reference. |
| `REJECTED -> CLOSED` | Appeal has expired OR member has acknowledged the rejection. | State, audit, and `archivedAt = now`. | None. |

## Minimal prerequisite operations

| Operation | Allowed demo role or actor | Data behavior |
|---|---|---|
| Mark required documents present and valid | `document_clerk` | Updates document metadata; the server derives the aggregate fact. |
| Assign assessor | `team_lead` | Stores the selected assessor identifier. |
| Complete assessment report | `assessor` | Stores report content/metadata and sets the completion flag. |
| Request additional information | `assessor` | Transition command includes a required description. |
| Record additional information | `document_clerk` | Server binds the record to the current `informationRequestCount`; the client cannot submit another sequence. |
| Reject a claim | `assessor` | Transition command includes the required rejection reason. |
| Confirm mock payment | `finance` | Sets confirmation and payment reference after payment initiation. |
| Record member acknowledgement | Demo operation | Sets the acknowledgement fact. |
| Run eligible system action | Fixed server actor | Uses `demo-system/system`; the role cannot be selected or supplied by the client. |

The claim amount and policy limit come from seeded sample claim data. The UI displays them but does not allow the assessor to edit the policy limit.

## Configuration and evaluation rules

### Preconditions

Use a small expression tree with `all`, `any`, `not`, and registered leaf operators. Every leaf references a registered fact path and includes a specific failure description.

- Unknown fact paths make the workflow definition invalid at startup.
- A registered fact that is absent at runtime fails that leaf with `FACT_MISSING`.
- Missing values never satisfy comparisons by coercion.
- `any` succeeds when one valid branch is true even if another branch is missing or false.
- The authoritative evaluation happens after the claim row is locked, even if the UI previously displayed the transition as available.

### Information-request limit

The `request_more_info` transition increments `informationRequestCount`. Values 1, 2, and 3 are accepted. An attempt when the current value is 3 is rejected with exactly:

`Maximum information requests exceeded — escalate to team lead`

Additional information is associated with the current request number rather than accepted by timestamp alone.

### Appeal period

`appealPeriodDays: 14` is a demo assumption stored in JSON config. Rejection calculates the expiry from the injected clock. The close condition remains the prompt requirement: appeal expired OR member acknowledged.

### Effect registry

The effect registry assigns each type a fixed phase:

| Phase | Effect types |
|---|---|
| Transactional | Start/reset assessment timer, create payment request, mark payment initiated, archive claim. |
| After commit | Notify assessor team, notify member, invoke mock payment system. |

Config cannot arbitrarily change an effect phase. Unknown effect types or phase mismatches make configuration loading fail.

An after-commit failure is caught and returned as `effectWarnings` alongside a successful transition response. State and audit remain committed. There is no durable retry in this scope.

## Persistence and transition transaction

Minimum tables or equivalent persistence models:

- `claims`: current state, sample claim facts, assessment facts, appeal facts, cycle counter, and lock/version metadata.
- `additional_information`: claim ID, request sequence, validity, and demo metadata.
- `payment_requests`: claim ID, mock status, confirmation, and reference.
- `claim_audit`: per-claim sequence, timestamp, from/to state, transition ID, user ID, role, and reason/notes.

Transition algorithm:

1. Resolve the demo user and role on the server.
2. Begin a PostgreSQL transaction.
3. Lock the claim row using `SELECT ... FOR UPDATE`.
4. Reload facts and evaluate transition existence, role, cycle limit, and preconditions.
5. Apply state and counter changes.
6. Insert the audit row.
7. Run only the registered transactional effects for that transition.
8. Commit.
9. Run registered after-commit mock effects and collect warnings without changing transition success.

The runtime database role has no `UPDATE` or `DELETE` privilege on `claim_audit`. A database trigger provides additional protection. Audit history is ordered by a per-claim sequence.

## Acceptance matrix

| Requirement | Acceptance criterion | Verification |
|---|---|---|
| Config-defined workflow | States, transitions, roles, conditions, cycle rule, and effects load from JSON; no application transition switch is required. | `CFG-01`, `CFG-02`, `EXT-01` |
| Invalid transitions rejected clearly | Error identifies current state, requested transition, and allowed transitions; nothing is persisted. | `SC-04` |
| Preconditions enforced | Each unmet condition returns a specific reason and produces no state/audit change. | `PRE-01` through `PRE-14` |
| Missing facts fail closed | Missing leaf facts do not pass; a true sibling in `any` can still satisfy the aggregate. | `PRE-13`, `PRE-14`, `CFG-02` |
| Role authorization | Server-resolved unauthorized role is rejected with required roles; no write occurs. | `SC-05`, `AUTH-01` |
| Side effects | Only configured handlers run; internal effects are atomic; after-commit failures do not report transition failure. | `FX-01` through `FX-04` |
| Payment request behavior | Approval alone creates the request; initiation requires it; unrelated transitions do not create one. | `PRE-10`, `FX-01` |
| Audit completeness | Every successful scenario transition produces one correctly ordered record with required actor and notes fields. | `SC-01` through `SC-03`, `AUD-01` |
| Audit immutability | Runtime database role cannot update or delete audit rows. | `AUD-02` |
| Atomic persistence | Audit or transactional-effect failure rolls back state, counter, and internal data. | `TX-01`, `TX-02` |
| Concurrent transitions | Two simultaneous commands from the same state cannot both succeed. | `TX-03` |
| Three-request limit | Requests 1-3 succeed; request 4 returns the exact required message and writes nothing. | `CYCLE-01`, `CYCLE-02` |
| Five required scenarios | All required paths produce their expected final state, audit count, and errors. | `SC-01` through `SC-05` |
| Minimal interface | UI shows state, prerequisites, outgoing transitions, required role, blocked reasons, execution result, and audit. | `UI-01` |
| Config-only extension | New state and transitions use registered capabilities and require no TypeScript or SQL schema change. | `EXT-01` |
| At least 15 tests | The planned suite contains 38 identified tests. | Test report lists every ID below. |

## Exact test plan

### Required scenarios

| ID | Test | Expected result |
|---|---|---|
| `SC-01` | Happy path: submitted through payment to closed. | Final state `CLOSED`; five ordered audit rows; payment reference present. |
| `SC-02` | Rejection path, followed by member acknowledgement and the system close action. | Final state `CLOSED`; four ordered audit rows; rejection notification includes reason and appeal instructions. |
| `SC-03` | One request-information loop followed by approval and payment. | Final state `CLOSED`; eight audit rows; counter is 1; the information record is bound to request 1. |
| `SC-04` | Attempt `SUBMITTED -> APPROVED`. | Specific `INVALID_TRANSITION`; state, counter, audit, payment, and effects unchanged. |
| `SC-05` | Attempt a valid transition using the wrong demo user. | Specific `UNAUTHORIZED_ROLE`; no write or effect. |

### Preconditions and data semantics

| ID | Test | Expected result |
|---|---|---|
| `PRE-01` | Verify documents when one required document is missing or invalid. | Fails with the document precondition reason. |
| `PRE-02` | Start assessment without an assigned assessor. | Fails with the assignment reason. |
| `PRE-03` | Approve with an incomplete report. | Fails with the report reason. |
| `PRE-04` | Approve when amount is above the policy limit. | Fails with the limit reason. |
| `PRE-05` | Approve when amount equals the policy limit. | Succeeds and creates one mock payment request. |
| `PRE-06` | Reject with an incomplete report. | Fails with the report reason. |
| `PRE-07` | Reject without a rejection reason. | Fails with the reason requirement. |
| `PRE-08` | Request information without a description. | Fails with the description requirement. |
| `PRE-09` | Return from pending info with information bound only to an older request number. | Fails; old information is not reused. |
| `PRE-10` | Initiate payment with no payment request. | Fails with the payment-request reason. |
| `PRE-11` | Close payment before confirmation. | Fails with the confirmation reason. |
| `PRE-12` | Close a rejected claim when neither appeal expiry nor acknowledgement is true. | Fails with the OR-condition reasons. |
| `PRE-13` | Close a rejected claim after the configured appeal period expires. | Succeeds through the fixed system actor. |
| `PRE-14` | Evaluate appeal-expired OR acknowledged when the expiry fact is missing but acknowledgement is true. | The `any` expression succeeds because one valid branch is true. |
| `DATA-01` | Enter pending info after a completed report. | Report completion becomes false while prior report content remains available for reference. |
| `DATA-02` | Record additional information for the active request. | Server assigns the current request counter; the client cannot override it. |
| `DATA-03` | Attempt to edit the sample policy limit as an assessor. | UI offers no control and API rejects or ignores the unauthorized field. |

### Cycle, authorization, transactions, audit, and effects

| ID | Test | Expected result |
|---|---|---|
| `CYCLE-01` | Complete request-information attempts 1, 2, and 3. | All three request transitions succeed and the counter reaches 3. |
| `CYCLE-02` | Attempt request-information transition 4. | Exact maximum-request message; no state, counter, audit, or effect change. |
| `AUTH-01` | Supply a valid demo user ID plus a forged role in the request. | Server uses its mapping and ignores/rejects the forged role. |
| `TX-01` | Force audit insertion to fail. | State, counter, and transactional effects roll back. |
| `TX-02` | Force a transactional payment-request effect to fail. | Approval state and audit roll back; no payment request remains. |
| `TX-03` | Submit two concurrent transitions against the same claim state. | Exactly one commits; the other re-evaluates and fails. |
| `AUD-01` | Query history after a multi-step path. | All required fields and contiguous per-claim sequence values are returned in order. |
| `AUD-02` | Attempt audit `UPDATE` and `DELETE` using the runtime DB role. | PostgreSQL rejects both operations. |
| `FX-01` | Execute approval and unrelated transitions. | Approval creates exactly one request; unrelated transitions create none. |
| `FX-02` | Complete a rejection. | Notification payload includes rejection reason and appeal instructions. |
| `FX-03` | Make an after-commit notification fail. | Transition response remains successful and includes an `effectWarnings` entry. |
| `FX-04` | Make the after-commit payment call fail. | State remains `PAYMENT_INITIATED`; audit remains committed; limitation states there is no durable retry. |

### Configuration, extension, and UI

| ID | Test | Expected result |
|---|---|---|
| `CFG-01` | Load config with an unknown effect, operator, state reference, role, or phase mismatch. | Startup validation rejects the definition with a precise path and reason. |
| `CFG-02` | Evaluate a registered fact that is absent and has no true `any` sibling. | Precondition fails with `FACT_MISSING`; it never passes by coercion. |
| `EXT-01` | Add `MANUAL_REVIEW` plus transitions using existing facts, `team_lead`, operators, and notification handler. | Engine, API, and UI support it after a config edit only; no TypeScript or SQL schema diff. |
| `UI-01` | Exercise the claim page as each demo role. | State, editable prerequisites, transitions, role requirements, blocked reasons, effect warnings, and audit are visible as applicable. |

## Config-only extension demonstration

Add a `MANUAL_REVIEW` state and transitions that reuse:

- Existing `assessment.reportComplete` or another registered assessment fact.
- Existing `team_lead` role.
- Existing boolean comparison operators.
- Existing notification handler.

Evidence must include:

1. The JSON-only diff.
2. A successful config validation result.
3. A transition into and out of the new state.
4. The new state and actions rendered by the UI.
5. Confirmation that no TypeScript or SQL schema file changed for the extension.

## Implementation increments and estimate

Target implementation time is **8 hours**, with a **0.5-1 hour contingency** for environment-specific issues.

| Increment | Estimate | Verifiable exit condition |
|---|---:|---|
| Finalize contracts, workflow JSON schema, fact catalog, and effect registry | 0.50 h | Valid definition loads; representative invalid definitions fail with precise errors. |
| Implement the pure workflow engine | 1.25 h | Transition, role, precondition, `any`, missing-fact, and cycle unit tests pass. |
| Add PostgreSQL schema, repositories, transaction locking, and audit protection | 1.00 h | Atomic rollback, concurrency, query-order, and immutability integration tests pass. |
| Implement NestJS claim, prerequisite, transition, demo-identity, and audit endpoints | 1.25 h | API tests cover role mapping, allowed data updates, blocked reasons, and transition responses. |
| Implement transactional and after-commit mock effect handling | 0.50 h | Payment scoping, rollback, notification content, and warning tests pass. |
| Build the minimal React claim page | 1.25 h | A user can prepare data, inspect transitions, execute them, see warnings, and view audit history. |
| Run required scenarios and complete config-extension verification | 1.00 h | `SC-01` through `SC-05` and `EXT-01` pass with captured outputs. |
| Prepare documentation and evidence | 1.25 h | Setup/run instructions, test results, scenario outputs, audit output, config diff, scope notes, and known limitations are reviewed. |
| **Total** | **8.00 h** | All acceptance rows have recorded evidence. |

## Evidence checklist

Do not report an item as passing until its command or interaction has actually completed successfully.

- Exact test command and complete pass/fail summary with test IDs.
- Output for each of the five required scenarios.
- Audit history for happy, rejection, and information-loop paths.
- Specific invalid-transition, unauthorized-role, precondition, and cycle-limit errors.
- Transaction rollback and concurrent-transition results.
- Database evidence that audit update and deletion are denied.
- After-commit failure response showing transition success plus `effectWarnings`.
- Rejection notification payload containing reason and appeal instructions.
- Amount-equals-limit and appeal-expired test results.
- JSON-only extension diff and its API/UI demonstration.
- Explicit limitations: demo identity, synchronous mocks, no durable retry, no idempotency framework, and no workflow versioning.
