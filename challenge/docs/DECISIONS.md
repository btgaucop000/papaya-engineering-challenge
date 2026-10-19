# Design Decisions

This document records decisions that have been discussed and accepted for Challenge 14. The original brief remains unchanged in `REQUIREMENTS.md`.

## Decision: Keep the implementation scope focused

### Context

The challenge is time-boxed and evaluates a configurable workflow engine, its behavior, and the evidence that it works. Production infrastructure would reduce the time available for the required scenarios and tests.

### Decision

Use NestJS, React, PostgreSQL, and a JSON workflow definition. Keep the workflow engine as a pure TypeScript module with no NestJS, UI, or database dependencies.

Include:

- Config-defined states, transitions, roles, preconditions, cycle limits, and side effects.
- Atomic state, cycle-counter, and audit persistence.
- Claim locking during transitions.
- Database-enforced audit immutability.
- Demo users mapped to roles by the server.
- A minimal UI for claim data, transitions, blocked reasons, transition execution, and audit history.
- Mock internal effects, notifications, and payment behavior.
- The five required scenarios, at least 15 tests, and a config-only extension demonstration.

Exclude:

- Outbox workers, queues, and durable retry scheduling.
- A general idempotency framework.
- Workflow versioning, hot reload, and workflow migrations.
- Production authentication and real external integrations.

### Rationale

This scope directly covers the brief while remaining achievable within the challenge time box.

### Trade-offs

After-commit effects can be lost if the process terminates after the database commit. Duplicate client requests are not handled by a general idempotency mechanism.

### Status

Accepted.

## Decision: Use a validated declarative workflow definition

### Context

The workflow must be configurable without hardcoding transitions in application logic, and invalid configuration must not silently weaken a precondition.

### Decision

The JSON definition contains states, transitions, authorized roles, precondition expressions, cycle limits, and effect descriptors. The engine supports a small declarative expression language such as `all`, `any`, `not`, `eq`, `exists`, and comparisons between registered facts.

Validate the entire definition at application startup:

- State and transition identifiers must be unique.
- Referenced source and destination states must exist.
- Roles, operators, facts, and effect types must be registered.
- Cycle limits must be positive integers and reference valid transitions.
- An unknown fact, operator, role, or effect type makes configuration loading fail.

At runtime, a registered fact that has no value fails its leaf condition with `FACT_MISSING`; it is never treated as satisfied. Boolean aggregation retains normal semantics: an `any` expression succeeds when at least one valid branch is true, even if another branch is false or missing.

### Rationale

Failing closed prevents configuration mistakes or incomplete data from authorizing a transition. Preserving normal `any` semantics is necessary for conditions such as appeal expiry OR member acknowledgement.

### Trade-offs

Adding a new predicate operator or effect type requires TypeScript registry code. Config-only extensions are limited to registered building blocks.

### Status

Accepted.

## Decision: Bind effect execution phases to the effect registry

### Context

Internal data changes must participate in the transition transaction, while mock calls must occur only after the transition commits. Allowing JSON to choose an arbitrary phase could move a database-dependent effect outside the transaction or an external call inside it.

### Decision

The effect registry assigns one fixed phase to every effect type: `transactional` or `afterCommit`. Workflow JSON references effect types and their arguments but does not control their phase. If a phase is present in JSON, validation rejects it unless it exactly matches the registered phase.

Transactional effects include assessment timer updates, payment-request creation, payment initiation state, and claim archival. After-commit effects include mock notifications and the mock payment-system call.

### Rationale

Central phase ownership makes transaction behavior explicit and prevents unsafe configuration.

### Trade-offs

Changing an effect's phase requires a code change and corresponding tests.

### Status

Accepted.

## Decision: Commit state, counter, audit, and internal effects atomically

### Context

The persisted current state must never disagree with the audit history or the information-request counter.

### Decision

For every transition, start a PostgreSQL transaction, lock the claim row, re-evaluate the transition against the locked snapshot, update the state and counter, insert the immutable audit record, run registered transactional effects, and then commit. Any failure rolls back all of these changes.

After-commit handlers run synchronously after a successful commit. Their failure does not roll back state or audit and does not turn the transition response into a failure. The response reports transition success plus an `effectWarnings` collection, and the UI must clearly state that the transition completed.

There is no durable retry within this challenge scope.

### Rationale

This preserves core workflow consistency while keeping external mock behavior simple and honest about its delivery limitations.

### Trade-offs

An after-commit effect can be lost on process failure and must be handled by an outbox in a production design.

### Status

Accepted.

## Decision: Serialize concurrent transitions and protect audit records

### Context

Concurrent requests must not both transition the same claim from a stale state, and audit records must be immutable.

### Decision

Use a row-level lock on the claim during the transition transaction. A second concurrent command re-evaluates after acquiring the lock and fails if its requested transition no longer applies.

Use a separate database owner/migration role and a restricted runtime role. The runtime role may `SELECT` and `INSERT` audit rows but may not `UPDATE` or `DELETE` them. Add a database trigger as defense in depth. Order audit history by a per-claim sequence rather than timestamp alone.

### Rationale

Locking gives deterministic transition behavior, while database permissions protect audit data independently of API behavior.

### Trade-offs

Transitions for the same claim are serialized. This is appropriate for the expected demo load.

### Status

Accepted.

## Decision: Count and bind additional-information requests by sequence

### Context

The loop is limited to three requests. Newly supplied information must belong to the current request rather than being inferred only from timestamps or reused from an earlier loop.

### Decision

Every successful `UNDER_ASSESSMENT -> PENDING_INFO` transition increments `informationRequestCount`. Counts 1 through 3 are allowed. The fourth request attempt is rejected before persistence with:

`Maximum information requests exceeded — escalate to team lead`

The request stores its sequence number. Information recorded while the claim is pending is associated by the server with the current sequence; the client cannot choose a different sequence. Returning to `DOCUMENTS_VERIFIED` requires at least one valid information record whose request sequence equals the current counter.

Entering `PENDING_INFO` invalidates the current assessment completion flag but may retain the previous report content for reference. Returning to `DOCUMENTS_VERIFIED` resets the assessment timer to `null`; the next transition to `UNDER_ASSESSMENT` starts a new timer.

### Rationale

Sequence binding is deterministic and prevents old information from satisfying a later request.

### Trade-offs

The demo models information as metadata rather than implementing document storage or version management.

### Status

Accepted.

## Decision: Model payment requests as internal mock data

### Context

Approval must create a payment request, and payment initiation must require one. The reduced scope excludes a real payment integration and durable background processing.

### Decision

Only the `UNDER_ASSESSMENT -> APPROVED` transition runs the transactional `create_payment_request` effect. It creates a mock payment request in the same transaction as the state and audit update.

`APPROVED -> PAYMENT_INITIATED` requires that request, updates its internal status transactionally, and then calls the mock payment-system handler after commit. Payment confirmation and its reference are entered through a demo operation before closing the claim.

### Rationale

This makes the payment precondition demonstrable without creating payment data for unrelated transitions.

### Trade-offs

The model proves workflow behavior but does not reproduce external settlement semantics.

### Status

Accepted.

## Decision: Use server-controlled demo identities and operations

### Context

Role authorization must be demonstrated without building production authentication.

### Decision

The UI selects a known demo user identifier. The server maps that identifier to exactly one demo role and ignores any role supplied by the client. Provide representative users for `document_clerk`, `team_lead`, `assessor`, and `finance`.

The `system` actor is not selectable as a demo user. A separate “Run eligible system action” operation invokes the transition with a fixed internal actor such as `demo-system/system`. No scheduler is included.

### Rationale

Server-side mapping demonstrates authorization without presenting client-controlled roles as security.

### Trade-offs

This is demo identity only and must not be described as production authentication.

### Status

Accepted.

## Decision: Use controlled sample claim and policy data

### Context

Approval depends on the claim amount being within the policy limit. Allowing an assessor to edit the limit would make the precondition meaningless.

### Decision

Seed the claim amount and policy limit as sample claim data. The UI may display both values, but the assessor cannot edit the policy limit. Tests cover amounts below, equal to, and above the limit as appropriate.

### Rationale

This keeps the approval rule meaningful while avoiding a policy administration subsystem.

### Trade-offs

Creating and maintaining policies is outside the demo.

### Status

Accepted.

## Decision: Configure a 14-day demo appeal period

### Context

A rejected claim may close after the appeal period expires or the member acknowledges it. The brief does not specify the duration.

### Decision

Set `appealPeriodDays` to 14 in workflow configuration and document it as a demo assumption rather than a prompt requirement. Rejection sets `appealExpiresAt` using the engine's injected clock.

The rejection notification must include the rejection reason and appeal instructions. Tests use a controlled clock to verify expiry without waiting in real time.

### Rationale

A configured duration makes the rule deterministic, visible, and testable.

### Trade-offs

The duration is not derived from real policy or jurisdiction rules.

### Status

Accepted.

## Decision: Bound config-only extensions to existing capabilities

### Context

The brief requires demonstrating that a new state or transition can be added through configuration only.

### Decision

The extension demonstration must use existing registered facts, roles, operators, and effect handlers. State columns use text and flexible business facts use JSONB, so the demonstration requires no TypeScript or database schema change. The API and UI obtain labels and transition metadata from the loaded definition.

### Rationale

This demonstrates genuine workflow configurability without claiming that arbitrary new business capabilities require no code.

### Trade-offs

New integrations, effect types, or predicate operators remain code changes.

### Status

Accepted.
