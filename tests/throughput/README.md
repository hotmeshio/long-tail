# Throughput Tests

Progressive test suite proving HotMesh YAML workflow performance — from baseline echo to full factory floor with real escalations.

Each test builds on the previous. Run them in order to understand the system.

## Prerequisites

```bash
docker compose up -d --build   # all services running
```

All tests run inside the Docker container:

```bash
docker compose exec long-tail npx ts-node tests/throughput/<test>.ts [args]
```

## Test Progression

### 01 — Echo (Baseline)

**What:** Single-worker flow. Trigger → echo → done.
**Why:** Establishes raw engine throughput without signals or hooks.
**YAML:** `yaml/01-echo.yaml` (app: yamltest)

```bash
docker compose exec long-tail npx ts-node tests/throughput/01-echo.ts 1000 10
```

**Measured:** ~300/sec sustained, 3.3ms avg on local Docker.

### 02 — Signal (Hook Pattern)

**What:** Trigger → worker → hook(pause) → done. Resume via `hotMesh.signal()`.
**Why:** Proves the hook/signal mechanism works — workflow pauses (status=1), signal resumes it (status=0).
**YAML:** `yaml/02-signal.yaml` (app: yamltest)

```bash
docker compose exec long-tail npx ts-node tests/throughput/02-signal.ts 5
```

### 03 — Chain (Sequential Stations)

**What:** 1 worker + 3 sequential stations (escalate → wait → resolve × 3).
**Why:** Proves chained hooks resume correctly — each signal advances the workflow to the next station.
**YAML:** `yaml/03-chain.yaml` (app: yamltest)

```bash
docker compose exec long-tail npx ts-node tests/throughput/03-chain.ts 10
```

### 04 — Factory Floor (Real Escalations)

**What:** 5 automated steps + 5 human stations + rollup = 22 activities.
Each station calls the real `escalate_and_wait` MCP tool, creating an escalation
in `lt_escalations`. Resolution via the Long Tail API sends a signal that resumes
the workflow. The resolve worker runs transactionally after the hook resumes.
**Why:** Proves the full production pattern end-to-end.
**YAML:** `yaml/04-factory.yaml` (app: longtail)

```bash
# Single workflow — watch each station
docker compose exec long-tail npx ts-node tests/throughput/04-factory.ts 1

# Multiple workflows
docker compose exec long-tail npx ts-node tests/throughput/04-factory.ts 10
```

**Flow per station:**
```
escalate_and_wait (MCP tool)
  → creates lt_escalations row with signal_routing { engine: "yaml", hookTopic, jobId }
  → hook pauses workflow durably

Human resolves escalation (dashboard form or API)
  → POST /api/escalations/:id/resolve
  → API reads signal_routing, detects engine=yaml
  → calls engine.signal(hookTopic, { job_id, ...resolverPayload })
  → hook resumes with human's response data

resolve worker (descendant of hook)
  → runs within workflow's transactional guarantee
  → marks station complete, continues to next station
```

## YAML Files

| File | App | Activities | Purpose |
|------|-----|-----------|---------|
| `yaml/01-echo.yaml` | yamltest | 2 | Baseline throughput |
| `yaml/02-signal.yaml` | yamltest | 4 | Single hook/signal |
| `yaml/03-chain.yaml` | yamltest | 14 | 3-station chain |
| `yaml/04-factory.yaml` | longtail | 22 | Full factory with real escalations |

## Performance Baselines (Local Docker, Mac ARM)

| Test | Rate | Avg | Notes |
|------|------|-----|-------|
| 01-echo (1K) | 303/sec | 3.3ms | Warm, single worker |
| 01-echo (100K) | 303/sec | 3.3ms | Linear scaling |
| 03-chain (10) | 10/10 pass | ~2.5s each | 500ms sleep between signals |
| 04-factory (1) | ~15s | 22 activities | 5 real escalation round-trips |

## Docker Tuning Applied

See `docs/cloud.md` for the full tuning guide. Key settings:

- **Postgres:** shared_buffers=256MB, wal_buffers=16MB, synchronous_commit=off (dev)
- **Node:** --max-old-space-size=3072 --max-semi-space-size=64
- **Resources:** long-tail 4-8 CPU / 2-4GB RAM, postgres 2-4 CPU / 1-2GB RAM
