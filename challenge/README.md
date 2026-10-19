# Advanced Challenge 14 — Claims Workflow Orchestrator

Selected stack: TypeScript, NestJS, React, and PostgreSQL. The current implementation includes the validated workflow engine, PostgreSQL persistence, and the NestJS claims API. The React UI, config-only extension demonstration, and final five-scenario evidence are not implemented yet.

## Prerequisites

- Node.js 20+
- Docker Desktop with Docker Compose

## Setup and run the API

From the repository root:

```powershell
Copy-Item .env.example .env
npm install
docker compose up -d postgres
npm run db:migrate
npm run demo:seed
npm run start:api
```

The API listens on `http://localhost:3000/api` by default. Set `API_PORT` in the shell to use another port. The checked-in local database defaults expose PostgreSQL on port `54329`; the development database is `claims_workflow` and API queries use the restricted `claims_runtime` role.

`npm run demo:seed` is idempotent and inserts only three fixed sample claim IDs. It never updates or deletes existing rows. It refuses database names ending in `_test`, refuses a database other than `DEMO_DATABASE_NAME` (default `claims_workflow`), and refuses a non-local database unless `DEMO_SEED_ALLOW_REMOTE=true` is explicitly set. There is intentionally no broad reset command.

To stop PostgreSQL without deleting its volume:

```powershell
docker compose stop postgres
```

## Demo identity model

Send a known user ID in `x-demo-user-id`. The server maps that ID to one role and never accepts a role from the client.

| User ID | Server role |
|---|---|
| `demo-document-clerk` | `document_clerk` |
| `demo-team-lead` | `team_lead` |
| `demo-assessor` | `assessor` |
| `demo-finance` | `finance` |

The `system` role is not a selectable demo user. `POST /api/claims/:claimId/system-actions/run` always invokes the single eligible system transition as `demo-system/system`. Member acknowledgement is a separate fixed demo operation rather than a user-selectable role.

## API endpoints

| Method and path | Purpose | Identity |
|---|---|---|
| `GET /api/health` | Health response | None |
| `GET /api/demo-users` | List server-defined demo users | None |
| `GET /api/claims` | List claims in the demo database | None |
| `GET /api/claims/:claimId` | Claim details and mock payment request | None |
| `GET /api/claims/:claimId/transitions` | Outgoing transitions, roles, authorization, and unmet conditions | Demo user header |
| `POST /api/claims/:claimId/transitions` | Execute a transition | Demo user header |
| `GET /api/claims/:claimId/audit` | Ordered immutable audit history | None |
| `PUT /api/claims/:claimId/documents` | Set required document metadata | `document_clerk` in `SUBMITTED` |
| `PUT /api/claims/:claimId/assessor` | Assign the known demo assessor | `team_lead` in `DOCUMENTS_VERIFIED` |
| `PUT /api/claims/:claimId/assessment-report` | Complete the assigned assessor's report | Assigned `assessor` in `UNDER_ASSESSMENT` |
| `POST /api/claims/:claimId/additional-information` | Record data for the active request sequence | `document_clerk` in `PENDING_INFO` |
| `PUT /api/claims/:claimId/payment-confirmation` | Confirm an initiated mock payment | `finance` in `PAYMENT_INITIATED` |
| `POST /api/claims/:claimId/member-acknowledgement` | Record fixed demo member acknowledgement | Fixed demo operation in `REJECTED` |
| `POST /api/claims/:claimId/system-actions/run` | Run the fixed eligible system transition | Fixed `demo-system/system` actor |

All request DTOs use an allowlist. Unknown fields are rejected, including client-supplied `role`, `state`, counters, audit fields, and `policyLimit`.

## Request examples

After seeding, use sample claim `11111111-1111-4111-8111-111111111111`.

List users and claims:

```powershell
Invoke-RestMethod http://localhost:3000/api/demo-users
Invoke-RestMethod http://localhost:3000/api/claims
```

Mark its document valid, then preview the transitions. Preview performs no writes.

```powershell
$claimId = '11111111-1111-4111-8111-111111111111'
$clerkHeaders = @{ 'x-demo-user-id' = 'demo-document-clerk' }
$documents = @{
  documents = @(
    @{ type = 'claim_form'; required = $true; present = $true; valid = $true }
  )
} | ConvertTo-Json -Depth 4

Invoke-RestMethod -Method Put -Uri "http://localhost:3000/api/claims/$claimId/documents" `
  -Headers $clerkHeaders -ContentType 'application/json' -Body $documents
Invoke-RestMethod -Uri "http://localhost:3000/api/claims/$claimId/transitions" `
  -Headers $clerkHeaders
```

Execute document verification and query audit:

```powershell
$transition = @{ transitionId = 'verify_documents'; reason = 'Demo verification' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/claims/$claimId/transitions" `
  -Headers $clerkHeaders -ContentType 'application/json' -Body $transition
Invoke-RestMethod "http://localhost:3000/api/claims/$claimId/audit"
```

A failed precondition has a specific status and body, for example HTTP `422`:

```json
{
  "statusCode": 422,
  "code": "PRECONDITION_FAILED",
  "message": "Preconditions failed for transition \"verify_documents\": All required documents must be present and valid",
  "details": {
    "transitionId": "verify_documents",
    "failures": [
      {
        "code": "CONDITION_NOT_MET",
        "fact": "documents.allRequiredPresentValid",
        "message": "All required documents must be present and valid"
      }
    ]
  }
}
```

Error mappings are: invalid input `400`, missing/unknown demo identity `401`, wrong role `403`, missing claim `404`, invalid transition or prerequisite state `409`, and failed business preconditions/cycle limit `422`.

## Design notes

- The JSON workflow remains the only declaration of state paths, roles, conditions, counters, and effects.
- Transition POST requests use the existing application service: begin transaction, `SELECT ... FOR UPDATE`, reload facts, re-evaluate, update state/counter/audit/internal effects, then commit.
- Preview reads the same persisted facts and engine conditions but never invokes effects or writes data. POST never trusts an earlier preview.
- Prerequisite writes lock the claim and check both server-resolved role and the allowed state. Additional information is bound to the active server-side request sequence.
- After-commit mocks run only after a successful commit. Failures are returned as `effectWarnings` on an otherwise successful response; there is no durable retry in this challenge scope.
- Mock rejection notifications include the rejection reason and appeal instructions. Other mock payloads include the request description or payment reference where applicable.
- Audit history is ordered by per-claim sequence. Runtime SQL permissions and a trigger reject audit updates and deletions.

See [DECISIONS.md](docs/DECISIONS.md) and [PLAN.md](docs/PLAN.md) for the accepted design and progress.

## Verification

```powershell
npm run test:unit
npm run test:api
npm run test:integration
npm run typecheck
```

`npm run test:api` and `npm run test:integration` create/migrate `claims_workflow_test`. Cleanup checks `current_database()` and refuses to run outside a database whose name ends with `_test`. The combined integration script runs the database-using files sequentially so their guarded cleanup cannot interfere.

Current verified coverage includes 29 workflow unit tests, 11 API/PostgreSQL tests, and 9 persistence/PostgreSQL tests. See [evidence](evidence/README.md) for the recorded commands and results.

## Remaining scope

- React UI and UI verification.
- Dedicated end-to-end evidence for all five named challenge scenarios.
- Config-only `MANUAL_REVIEW` extension demonstration.
- Final scenario/audit/config-diff evidence and submission polish.

Intentional limitations remain: demo identities only, synchronous mocks, no durable retry/outbox, no general idempotency framework, and no workflow versioning or hot reload.

## AI Conversation

Raw conversation records are preserved under [ai-conversation](ai-conversation/README.md).
