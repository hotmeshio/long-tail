# Test Suite Guide

## Quick Reference

```bash
# Frontend tests (fast — ~4s)
cd dashboard && npx vitest run

# Backend: fast unit/integration tests only (~75s)
npx vitest run --exclude 'tests/workflows/**'

# Backend: workflow tests only (~3min)
npx vitest run tests/workflows

# Backend: all tests (~5min)
npx vitest run

# Integration tests (requires Docker — mcpQuery + mcpTriage lifecycle)
npx vitest run --config tests/integration/vitest.config.ts

# Functional tests (requires Docker — browser-based Playwright e2e)
npx vitest run --config tests/functional/vitest.config.ts

# Full integration reset (down → rebuild → run)
npm run test:integration
```

## Test Categories

### Frontend (`dashboard/src/**/*.test.{ts,tsx}`)
- Pure unit tests: components, hooks, utils, API mocks
- Environment: jsdom, no external dependencies
- Always run these first — they're instant and catch most regressions

### Backend Fast (`tests/{modules,services,routes}/**/*.test.ts`)
- **Recommended for iterative development** — run after every code change
- Organized by layer: `tests/modules/` (auth, config, start), `tests/services/` (escalations, events, MCP, OAuth, YAML workflow, etc.), `tests/routes/` (files mirroring routes/)
- Requires: PostgreSQL (`longtail_test` database)
- Sequential execution (`fileParallelism: false`)

### Backend Workflows (`tests/workflows/*.test.ts`)
- Full durable workflow execution: escalation, orchestration, triage, export, prune
- Requires: PostgreSQL + HotMesh engine startup per file
- Some tests call external APIs (LLM Vision) with long timeouts

### Integration Tests (`tests/integration/`)
- Require Docker (`docker compose up -d --build`)
- **mcpQuery lifecycle**: dynamic → compile → deploy → deterministic → router verification
- **mcpTriage lifecycle**: escalation → triage → remediation → re-run
- Run with: `npx vitest run --config tests/integration/vitest.config.ts`

### Functional Tests (`tests/functional/`)
- Require Docker + running dashboard
- Browser-based Playwright e2e through the dashboard UI
- Run with: `npx vitest run --config tests/functional/vitest.config.ts`

## What Each Fast Test Covers

| File | What it covers |
|------|---------------|
| `yaml-workflow-utils.test.ts` | YAML parsing, LLM compaction, tool arg capping, name sanitization, step extraction |
| `escalations.test.ts` | Create, claim, filter, stats, bulk operations |
| `routes/*.test.ts` | HTTP API routes (files mirroring routes/ — see tests/routes/) |
| `pattern-detector.test.ts` | Iteration pattern detection, array source matching |
| `input-analyzer.test.ts` | Input classification (dynamic/fixed/wired), schema enrichment |
| `auth.test.ts` | JWT, middleware, role-based access |
| `config.test.ts` | Workflow config CRUD, role management |
| `users.test.ts` | User CRUD, role assignment |
| `db-server.test.ts` | MCP DB server tools (find_tasks, escalation stats) |
| `events.test.ts` | NATS event adapter, publish/subscribe |
| `mcp.test.ts` | MCP server CRUD, tag-based discovery |
| `invocation.test.ts` | Workflow invocation API |
| `start.test.ts` | Startup configuration, adapter registration |
| `hotmesh-utils.test.ts` | HotMesh utility functions |
| `controlplane.test.ts` | Rollcall, throttle, streams |
| `analyze-documents.test.ts` | Document analysis utilities |
| `oauth-providers.test.ts` | OAuth provider registry, URL generation, display names |
| `oauth-crypto.test.ts` | AES-256-GCM encrypt/decrypt, tamper detection, edge cases |
| `nats-pubsub.test.ts` | NATS pub/sub reliability |
| `oauth-routes.test.ts` | OAuth flow logic: state, CSRF, JWT issuance |
| `mcp-client.test.ts` | Built-in server auto-connection |
| `oauth-state.test.ts` | CSRF state + PKCE code verifier management |
| `oauth-init.test.ts` | Provider auto-detection from env vars and startup config |
| `vision-server.test.ts` | Vision MCP server tools |
| `publish.test.ts` | Event publishing |

## Known Slow / Flaky Tests

| File | Why | Timeout |
|------|-----|---------|
| `workflows/process-claim.test.ts` | Vision API + full escalation lifecycle | 90s per test |
| `workflows/export.test.ts` | Large export reconstruction, many assertions | 60s per test |
| `workflows/mcp-triage.test.ts` | LLM agentic loop with tool calls | 60s per test |
| `workflows/verify-document.test.ts` | Vision API latency | 60s per test |
| `workflows/verify-document-mcp.test.ts` | Multiple Vision API calls | 60s per test |
| `workflows/kitchen-sink.test.ts` | Durable 2s sleep built into workflow | 60s setup |

These are **integration tests that depend on external APIs and durable workflow timing**. Occasional failures are expected (API timeouts, race conditions in scout role acquisition). Re-running a single failed file usually passes.

## Docker Reset Procedure

When Docker has build or startup issues:

```bash
# Full reset: stop, clean volumes, rebuild
docker compose down -v
docker compose up -d --build

# Verify server starts (wait ~10s for seeding)
docker compose logs --tail=20 long-tail
```

## Recommended CI Strategy

```bash
# Stage 1: fast feedback (< 5s)
cd dashboard && npx vitest run

# Stage 2: backend unit/integration (< 45s)
cd .. && npx vitest run --exclude 'tests/workflows/**'

# Stage 3: workflow integration (run with retry)
npx vitest run tests/workflows --retry 1

# Stage 4: Docker integration (optional — slower, requires running stack)
# docker compose up -d --build
# npx vitest run --config tests/integration/vitest.config.ts
```

## Config Notes

- Backend config: `vitest.config.ts` (root) — 30s test timeout, 60s hook timeout
- Frontend config: `dashboard/vitest.config.ts` — jsdom, no timeouts needed
- Integration config: `tests/integration/vitest.config.ts` — waits for health check
- Global setup clears stale HotMesh scout roles to prevent TTL deadlocks
- Database safety: hardcoded `longtail_test` — tests refuse to run against other DBs
- LLM abstraction: all LLM calls use `services/llm` — tests work with any configured provider
