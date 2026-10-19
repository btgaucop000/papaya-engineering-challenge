# Verification Evidence Index

Verification was rerun on 2026-10-19 (UTC+07:00) at commit `7022161e2decd95410c42346832f9dd72fbcdc6c`.

The working tree was dirty for every run because the workflow-persistence implementation and evidence were not committed. Each log records the exact pre-run `git status --short`, command, start and finish times, merged stdout/stderr, and exit code. No database connection strings, environment variables, or passwords are included.

| Check | Started at | Command | Exit code | Evidence |
|---|---|---|---:|---|
| Unit tests | 2026-10-19T22:08:40.600+07:00 | `npm run test:unit` | 0 | [2026-10-19-test-unit.log](2026-10-19-test-unit.log) |
| PostgreSQL integration tests | 2026-10-19T22:08:49.381+07:00 | `npm run test:integration` | 0 | [2026-10-19-test-integration.log](2026-10-19-test-integration.log) |
| TypeScript typecheck | 2026-10-19T22:08:57.879+07:00 | `npm run typecheck` | 0 | [2026-10-19-typecheck.log](2026-10-19-typecheck.log) |

## Claims API increment

The API implementation was verified on the uncommitted `feat/claims-api` worktree based on `5c638ee`. The evidence includes Git preparation, final unit/integration/typecheck results, idempotent demo seeding, and a real API entrypoint smoke test.

- [2026-10-19-claims-api.md](2026-10-19-claims-api.md)

## Claims UI increment

The React UI was verified on the uncommitted `feat/claims-ui` worktree based on `origin/main` at `4a2c155`. The evidence records the final checks, guarded browser fixture, successful/blocked Playwright flow, and real desktop/mobile screenshots.

- [2026-10-20-claims-ui.md](2026-10-20-claims-ui.md)
- [Desktop screenshot](claims-ui-desktop.png)
- [Mobile screenshot](claims-ui-mobile.png)
