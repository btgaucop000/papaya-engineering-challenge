# Advanced Challenge 14 — Claims Workflow Orchestrator

Selected stack: TypeScript, NestJS, React, and PostgreSQL. The current implementation includes the pure workflow engine and PostgreSQL persistence slices. HTTP/NestJS, React, outbox processing, and real external integrations are not implemented yet.

## Prerequisites

- Node.js 20+
- Docker Desktop with Docker Compose

## Setup

From the repository root:

```powershell
Copy-Item .env.example .env
npm install
docker compose up -d postgres
npm run db:migrate
```

The checked-in local defaults expose PostgreSQL on port `54329`. The development database is `claims_workflow`; the restricted application role is `claims_runtime`. To stop the database without deleting its volume:

```powershell
docker compose stop postgres
```

`npm run test:integration` creates `claims_workflow_test` if necessary and applies the same migrations there. Integration-test cleanup first queries `current_database()` and refuses to run unless its name ends with `_test`; it never truncates the development database.

Available database commands:

```powershell
npm run db:migrate
npm run db:test:setup
```

## Design

- The JSON workflow remains the only declaration of state paths, roles, conditions, counters, and effects.
- The application service opens a PostgreSQL transaction and locks the claim with `SELECT ... FOR UPDATE` before loading related facts and asking the pure engine for a transition plan.
- State, cycle counter, per-claim audit sequence, audit record, and transactional effects commit or roll back together.
- Transactional effects are selected by config and dispatched through a handler registry. Approval's configured `create_payment_request` effect is the only path that creates a mock payment request.
- The runtime role has only `SELECT`/`INSERT` on `claim_audit`; a database trigger additionally rejects `UPDATE` and `DELETE` for privileged table owners.
- After-commit mocks run synchronously and report warnings without reversing a committed transition. There is intentionally no outbox in this slice.

See [DECISIONS.md](docs/DECISIONS.md) and [PLAN.md](docs/PLAN.md) for the accepted design and current progress.

## Verification

The following commands were run successfully on 2026-10-19 against PostgreSQL 16 in Docker:

```powershell
npm run test:unit
npm run test:integration
npm run typecheck
```

- Unit: 29 passed, 0 failed.
- PostgreSQL integration: 8 passed, 0 failed.
- TypeScript typecheck: passed.

The integration suite verifies successful state/audit persistence, no writes on rejection, rollback after a real audit constraint error, rollback after a real transactional-effect uniqueness error, audit permission and trigger enforcement, concurrent row-lock serialization, config-scoped payment creation, and active-request sequence binding.

## Scenario Results

The five complete challenge scenarios remain pending until the API/demo-operation increment. Persistence behavior is verified independently by the integration suite above.

## Audit Output

The persistence integration suite asserts ordered, contiguous per-claim audit sequences and all required actor/state/reason fields. Full scenario audit output remains pending.

## Configuration Extension Demo

Pending. The persistence schema uses text states and does not constrain state IDs, so an extension using existing facts/effects requires no SQL schema change; the complete API/UI demonstration is not yet implemented.

## AI Conversation

_Placeholder for links to conversation records after they have been captured. See [AI conversation guidance](ai-conversation/README.md)._
