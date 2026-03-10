# Test Suite Guide

## Quick Reference

```bash
# Frontend tests (fast — ~3s, 44 files, 435+ tests)
cd dashboard && npx vitest run

# Backend: fast unit/integration tests only (~60s, 17 files)
npx vitest run --exclude 'tests/workflows/**'

# Backend: workflow tests only (~4-5min, 10 files)
npx vitest run tests/workflows

# Backend: all tests (~5-6min, 27 files)
npx vitest run
```

## Test Categories

### Frontend (`dashboard/src/**/*.test.{ts,tsx}`)
- **44 files, 435+ tests, ~3 seconds**
- Pure unit tests: components, hooks, utils, API mocks
- Environment: jsdom, no external dependencies
- Always run these first — they're instant and catch most regressions

### Backend Fast (`tests/*.test.ts` — root level)
- **17 files, ~60 seconds**
- Auth, config, routes, DB server, MCP client, events, users, etc.
- Requires: PostgreSQL (`longtail_test` database)
- Sequential execution (`fileParallelism: false`)

### Backend Workflows (`tests/workflows/*.test.ts`)
- **10 files, ~4-5 minutes**
- Full durable workflow execution: escalation, orchestration, export
- Requires: PostgreSQL + HotMesh engine startup per file
- Some tests call external APIs (OpenAI Vision) with long timeouts

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

# Stage 2: backend unit/integration (< 90s)
cd .. && npx vitest run --exclude 'tests/workflows/**'

# Stage 3: workflow integration (run with retry)
npx vitest run tests/workflows --retry 1
```

## Config Notes

- Backend config: `vitest.config.ts` (root) — 30s test timeout, 60s hook timeout
- Frontend config: `dashboard/vitest.config.ts` — jsdom, no timeouts needed
- Global setup clears stale HotMesh scout roles to prevent TTL deadlocks
- Database safety: hardcoded `longtail_test` — tests refuse to run against other DBs
