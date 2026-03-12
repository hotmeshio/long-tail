# Test Suite Guide

## Quick Reference

```bash
# Frontend tests (fast — ~3s, 45 files, 455 tests)
cd dashboard && npx vitest run

# Backend: fast unit/integration tests only (~35s, 18 files)
npx vitest run --exclude 'tests/workflows/**'

# Backend: workflow tests only (~4-5min, 10 files)
npx vitest run tests/workflows

# Backend: all tests (~5-6min, 28 files)
npx vitest run
```

## Test Categories

### Frontend (`dashboard/src/**/*.test.{ts,tsx}`)
- **45 files, 455 tests, ~3 seconds**
- Pure unit tests: components, hooks, utils, API mocks
- Environment: jsdom, no external dependencies
- Always run these first — they're instant and catch most regressions

### Backend Fast (`tests/*.test.ts` — root level)
- **18 files, 346 tests, ~35 seconds**
- Auth, config, routes, DB server, MCP client, events, users, escalations, etc.
- Requires: PostgreSQL (`longtail_test` database)
- Sequential execution (`fileParallelism: false`)

### Backend Workflows (`tests/workflows/*.test.ts`)
- **10 files, 72 tests, ~4-5 minutes**
- Full durable workflow execution: escalation, orchestration, export, prune
- Requires: PostgreSQL + HotMesh engine startup per file
- Some tests call external APIs (OpenAI Vision) with long timeouts

## Test Organization

Tests are structured to tell a story. Each test file uses `describe` blocks that
progress through the feature's lifecycle — an engineer reading the tests should
understand how the service works without reading the implementation. For example,
`escalations.test.ts` walks through: create → claim → statistics → list/filter →
available queue. The `export.test.ts` suite progresses from raw exports through
filtering, escalation, execution history, event classification, and data lifecycle.

## Known Slow / Flaky Tests

| File | Why | Timeout |
|------|-----|---------|
| `workflows/process-claim.test.ts` | Vision API + full escalation lifecycle | 90s per test |
| `workflows/export.test.ts` | Large export reconstruction, many assertions | 60s per test |
| `workflows/mcp-triage.test.ts` | LLM agentic loop with tool calls | 60s per test |
| `workflows/verify-document.test.ts` | OpenAI Vision API latency | 60s per test |
| `workflows/verify-document-mcp.test.ts` | Multiple Vision API calls | 60s per test |
| `workflows/kitchen-sink.test.ts` | Durable 2s sleep built into workflow | 60s setup |

These tests are **integration tests that depend on external APIs and durable workflow timing**. Occasional failures are expected (API timeouts, race conditions in scout role acquisition). Re-running a single failed file usually passes.

## Recommended CI Strategy

```bash
# Stage 1: fast feedback (< 5s)
cd dashboard && npx vitest run

# Stage 2: backend unit/integration (< 45s)
cd .. && npx vitest run --exclude 'tests/workflows/**'

# Stage 3: workflow integration (run with retry)
npx vitest run tests/workflows --retry 1
```

## Config Notes

- Backend config: `vitest.config.ts` (root) — 30s test timeout, 60s hook timeout
- Frontend config: `dashboard/vitest.config.ts` — jsdom, no timeouts needed
- Global setup clears stale HotMesh scout roles to prevent TTL deadlocks
- Database safety: hardcoded `longtail_test` — tests refuse to run against other DBs
