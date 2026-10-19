# Claims API Verification Evidence — 2026-10-19 (UTC+07:00)

## Git preparation

- Initial branch: `feat/workflow-persistence`.
- Initial worktree: clean (`git status --porcelain=v1` returned no entries).
- `git fetch --prune origin` advanced `origin/main` from `7022161` to `5c638ee`.
- Local `main` was fast-forwarded to `5c638ee` with no conflict.
- Working branch created: `feat/claims-api`.
- At the time these verification results were captured, no commit or push had been performed.

## Final checks

All commands were executed from the repository root against the current uncommitted `feat/claims-api` worktree.

| Command | Actual result |
|---|---|
| `npm run test:unit` | Exit 0; 29 tests passed, 0 failed across 6 suites. |
| `npm run test:integration` | Exit 0; 20 PostgreSQL tests passed, 0 failed: 11 NestJS API tests and 9 persistence tests. |
| `npm run typecheck` | Exit 0; `tsc -p tsconfig.json --noEmit` reported no errors. |
| `npm run demo:seed` | First run: 3 inserted, 0 existing. Second run: 0 inserted, 3 existing. |
| API entrypoint smoke test | `GET /api/health` returned `{"status":"ok"}` and `GET /api/claims` returned 3 seeded claims. |
| `git diff --check` | Exit 0; no whitespace errors. |

The integration command created/migrated `claims_workflow_test` and the suites verified the database suffix before cleanup. The database test files run with `--test-concurrency=1`; an earlier combined run exposed that parallel files could truncate each other's shared test database, so the final script serializes them.

## API integration coverage

- `API-01`: demo users, claim list, and claim detail.
- `API-02`: allowlisted input and rejection of direct state/policy/counter/audit fields.
- `API-03`: server-side role resolution and rejection of wrong/forged roles.
- `API-04`: outgoing transition preview with roles and unmet conditions, with no writes.
- `API-05`: specific `422 PRECONDITION_FAILED` response.
- `API-06`: prerequisite role and state enforcement.
- `API-07`: valid approval/payment path through `CLOSED`, including ordered audit.
- `API-08`: server-bound active information-request sequence.
- `API-09`: member acknowledgement and fixed `demo-system/system` action.
- `API-10`: after-commit failure returned as a warning while state and audit remain committed.
- `API-11`: specific identity, not-found, and invalid-transition HTTP mappings.

The persistence suite additionally verified rejection-notification details, atomic rollback, audit immutability, row-lock serialization, payment-effect scoping, and request-sequence persistence.
