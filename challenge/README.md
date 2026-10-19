# Advanced Challenge 14 — Claims Workflow Orchestrator

Selected stack: TypeScript, NestJS, React, and PostgreSQL. The implementation includes the validated workflow engine, atomic PostgreSQL persistence, NestJS claims API, responsive React workflow desk, five required scenario runner, and config-only `MANUAL_REVIEW` demonstration.

## Prerequisites

- Node.js 20+
- Docker Desktop with Docker Compose
- Chromium installed through `npx playwright install chromium` for browser checks

Copy `.env.example` to `.env` before running local services. The checked-in example contains local-only development and test URLs; do not reuse those credentials outside this demo.

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

## Run the frontend

Keep the API running in one terminal. In a second terminal, from the repository root:

```powershell
npm run dev:ui
```

Open `http://127.0.0.1:4173`. The Vite development server proxies `/api` to the backend at `http://localhost:3000`, so the UI does not require a separate CORS configuration.

For a production frontend build and local preview:

```powershell
npm run build
npm run start:api
# In a second terminal:
npm run preview:ui
```

The production frontend build is written to `dist/frontend`. The preview server uses the same `/api` proxy; a deployed static build should place the frontend and API behind the same origin or an equivalent reverse proxy.

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
| `GET /api/claims` | List claims with config-defined state labels | None |
| `GET /api/claims/:claimId` | Claim details, state label, and mock payment request | None |
| `GET /api/claims/:claimId/transitions` | Outgoing transition/state labels, roles, authorization, and unmet conditions | Demo user header |
| `POST /api/claims/:claimId/transitions` | Execute a transition | Demo user header |
| `GET /api/claims/:claimId/audit` | Ordered immutable audit history with config-defined labels | None |
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
npm run build
npm run test:ui:e2e
npm run verify:scenarios
npm run verify:extension:config
npm run test:extension:e2e
```

`npm run test:api` and `npm run test:integration` create/migrate `claims_workflow_test`. Cleanup checks `current_database()` and refuses to run outside a database whose name ends with `_test`. The combined integration script runs the database-using files sequentially so their guarded cleanup cannot interfere.

Current verified coverage includes 29 workflow unit tests, 11 API/PostgreSQL tests, 9 persistence/PostgreSQL tests, one original-workflow Playwright check, and one config-extension Playwright check. This is 51 named automated checks, exceeding the minimum of 15. See [final verification evidence](evidence/2026-10-20-final-verification.md) for the actual commands, exit codes, environment, Git state, and criterion mapping.

The browser flow uses the dedicated `_test` database and refuses to prepare data anywhere else. Install the matching browser once, ensure PostgreSQL is running, then run:

```powershell
npx playwright install chromium
npm run db:test:setup
npm run test:ui:e2e
```

Playwright starts an isolated API on port `3100` and the UI on port `4273`, so it can run while the normal local UI remains open on `4173`. It verifies a blocked document transition, completes a successful document transition, confirms the refreshed audit entry, and captures the checked desktop/mobile evidence.

## Required scenario demo

`npm run verify:scenarios` creates/migrates `claims_workflow_test`, verifies the `_test` database boundary, and creates a separate UUID claim for every required scenario. It asserts final state, audit count and ordering, the information-request counter, exact domain errors, and unchanged state/audit/payment/effects for failed transitions. It never reads or changes the development database.

The actual run, claim IDs, audit rows, and failure output are recorded in [required scenario evidence](evidence/2026-10-20-required-scenarios.md).

## Config-only extension demo

The original [workflow config](config/claims-workflow.json) remains unchanged. The separate [manual-review config](config/claims-workflow.manual-review.json) adds one state and two transitions using only the registered `assessment.reportComplete` fact, `eq` operator, `team_lead` role, and notification handlers. The exact [JSON-only diff](evidence/config-only-extension.diff) is part of the evidence.

Validate its structure and capability delta:

```powershell
npm run verify:extension:config
```

Run the API manually with the extension while keeping the default startup behavior unchanged:

```powershell
$env:WORKFLOW_CONFIG_PATH = 'challenge/config/claims-workflow.manual-review.json'
npm run start:api
```

Run the automated API-metadata and UI proof:

```powershell
npm run db:test:setup
npm run test:extension:e2e
```

The workflow extension itself is JSON only. `WORKFLOW_CONFIG_PATH`, the dedicated verifier, and Playwright fixture are demo-support code. No workflow-engine, database migration/schema, or state-specific React branch was changed; the API and UI consume definition metadata generically. See the UI in [Manual Review](evidence/config-extension-manual-review.png), the [completed round trip and audit](evidence/config-extension-ui.png), and [final verification evidence](evidence/2026-10-20-final-verification.md).

## Approach, decisions, and limitations

The approach keeps transition policy declarative and the engine pure, then performs locked PostgreSQL transitions that atomically persist state, counters, audit, and internal effects. The API resolves fixed demo identities server-side, and the UI renders labels, roles, transitions, and blocked reasons supplied by the API. Accepted trade-offs and rationale are recorded in [DECISIONS.md](docs/DECISIONS.md); implementation status and acceptance mapping are in [PLAN.md](docs/PLAN.md).

Known limitations are intentional: demo identities only, synchronous mocks, no durable retry/outbox, no general idempotency framework, no workflow versioning or hot reload, and no real external payment/notification/document integrations.

## AI Conversation

Raw conversation records are preserved unchanged under [ai-conversation](ai-conversation/README.md).
