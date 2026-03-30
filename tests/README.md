# Test Suite Guide

## Quick Reference

```bash
# Frontend tests (fast — ~4s, 52 files, 526 tests)
cd dashboard && npx vitest run

# Backend: fast unit/integration tests only (~35s, 28 files, 445 tests)
npx vitest run --exclude 'tests/workflows/**'

# Backend: workflow tests only (~3min, 8 files, 65 tests)
npx vitest run tests/workflows

# Backend: all tests (~4-5min, 36 files, 510 tests)
npx vitest run

# Integration tests (requires Docker — mcpQuery + mcpTriage lifecycle)
npx vitest run --config tests/integration/vitest.config.ts

# Functional tests (requires Docker — browser-based Playwright e2e)
npx vitest run --config tests/functional/vitest.config.ts

# Full integration reset (down → rebuild → run)
npm run test:integration
```

## Total Test Counts

| Suite | Files | Tests | Duration |
|-------|-------|-------|----------|
| Frontend | 52 | 526 | ~4s |
| Backend fast | 28 | 445 | ~35s |
| Backend workflows | 8 | 65 | ~3min |
| **Backend total** | **36** | **510** | **~4-5min** |
| Integration (Docker) | 2 | 15 | ~5min |
| Functional (Docker) | — | — | varies |
| **Grand total** | **90+** | **1,051+** | — |

## Test Categories

### Frontend (`dashboard/src/**/*.test.{ts,tsx}`)
- **52 files, 526 tests, ~4 seconds**
- Pure unit tests: components, hooks, utils, API mocks
- Environment: jsdom, no external dependencies
- Always run these first — they're instant and catch most regressions

### Backend Fast (`tests/*.test.ts` — root level)
- **28 files, 445 tests, ~35 seconds**
- **Recommended for iterative development** — run after every code change
- Auth, config, routes, DB server, MCP client, events, users, escalations, control plane, pattern detection, input analysis, YAML workflow pipeline, OAuth (crypto, state, providers, initialization, routes)
- Requires: PostgreSQL (`longtail_test` database)
- Sequential execution (`fileParallelism: false`)

### Backend Workflows (`tests/workflows/*.test.ts`)
- **8 files, 65 tests, ~3 minutes**
- Full durable workflow execution: escalation, orchestration, triage, export, prune
- Requires: PostgreSQL + HotMesh engine startup per file
- Some tests call external APIs (LLM Vision) with long timeouts

### Integration Tests (`tests/integration/`)
- **2 files, 15 tests, ~5 minutes**
- Require Docker (`docker compose up -d --build`)
- **mcpQuery lifecycle**: dynamic → compile → deploy → deterministic → router verification
- **mcpTriage lifecycle**: escalation → triage → remediation → re-run
- Run with: `npx vitest run --config tests/integration/vitest.config.ts`

### Functional Tests (`tests/functional/`)
- Require Docker + running dashboard
- Browser-based Playwright e2e through the dashboard UI
- Run with: `npx vitest run --config tests/functional/vitest.config.ts`

## What Each Fast Test Covers

| File | Tests | What it covers |
|------|-------|---------------|
| `yaml-workflow-utils.test.ts` | 21 | YAML parsing, LLM compaction, tool arg capping, name sanitization, step extraction |
| `escalations.test.ts` | 55 | Create, claim, filter, stats, bulk operations |
| `routes.test.ts` | 53 | HTTP API endpoints (auth, tasks, escalations, workflows, MCP) |
| `pattern-detector.test.ts` | 47 | Iteration pattern detection, array source matching |
| `input-analyzer.test.ts` | 37 | Input classification (dynamic/fixed/wired), schema enrichment |
| `auth.test.ts` | 23 | JWT, middleware, role-based access |
| `config.test.ts` | 22 | Workflow config CRUD, role management |
| `users.test.ts` | 19 | User CRUD, role assignment |
| `db-server.test.ts` | 18 | MCP DB server tools (find_tasks, escalation stats) |
| `events.test.ts` | 16 | NATS event adapter, publish/subscribe |
| `mcp.test.ts` | 14 | MCP server CRUD, tag-based discovery |
| `invocation.test.ts` | 14 | Workflow invocation API |
| `start.test.ts` | 12 | Startup configuration, adapter registration |
| `hotmesh-utils.test.ts` | 10 | HotMesh utility functions |
| `controlplane.test.ts` | 8 | Rollcall, throttle, streams |
| `analyze-documents.test.ts` | 8 | Document analysis utilities |
| `oauth-providers.test.ts` | 8 | OAuth provider registry, URL generation, display names |
| `oauth-crypto.test.ts` | 6 | AES-256-GCM encrypt/decrypt, tamper detection, edge cases |
| `nats-pubsub.test.ts` | 6 | NATS pub/sub reliability |
| `oauth-routes.test.ts` | 6 | OAuth flow logic: state, CSRF, JWT issuance |
| `mcp-client.test.ts` | 4 | Built-in server auto-connection |
| `oauth-state.test.ts` | 4 | CSRF state + PKCE code verifier management |
| `oauth-init.test.ts` | 4 | Provider auto-detection from env vars and startup config |
| `vision-server.test.ts` | 3 | Vision MCP server tools |
| `publish.test.ts` | 3 | Event publishing |

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
