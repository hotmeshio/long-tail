# Cloud Deployment

Long Tail embeds its own server. Your application calls `start()` with a config object — that's the entire entry point. In production you typically run two container types that share the same PostgreSQL database: one serves HTTP requests, the other executes workflows. This separation lets each tier scale independently.

## Why Separate

| Concern | API container | Worker container |
|---------|--------------|-----------------|
| Purpose | Serve REST endpoints, authenticate requests, start workflows, query tasks and escalations | Execute workflow code, run activities, manage interceptors |
| Scaling trigger | Request volume | Workflow queue depth |
| Resource profile | I/O-bound (Postgres reads, HTTP) | Potentially CPU-bound (AI calls, document processing) |
| Network exposure | Public (behind load balancer) | Private (no inbound traffic) |
| Deploy cadence | Change routes or auth without touching workers | Update workflow logic without restarting the API |

Both containers install the same packages (`@hotmeshio/long-tail`, `@hotmeshio/hotmesh`) and share the same PostgreSQL connection string. They differ only in what they configure at boot.

## API Container

The API container runs the embedded server and serves REST endpoints. It does not start workers — no workflow execution happens here.

```typescript
// api.ts — API container entry point
import { start } from '@hotmeshio/long-tail';

await start({
  database: { connectionString: process.env.DATABASE_URL },
  server: { port: Number(process.env.PORT) || 3000 },
  auth: { secret: process.env.JWT_SECRET },
});
```

That's it. Migrations run, the server starts, routes are mounted, auth is configured. The API container needs network ingress (load balancer, domain). It reads and writes Postgres but never processes workflow task queues.

## Worker Container

The worker container registers the LT interceptor, starts workflow workers, and optionally connects telemetry, event, and maintenance adapters. It runs no HTTP server.

```typescript
// worker.ts — Worker container entry point
import { start } from '@hotmeshio/long-tail';
import * as reviewContent from './workflows/review-content';
import * as verifyDocument from './workflows/verify-document';

await start({
  database: { connectionString: process.env.DATABASE_URL },
  server: { enabled: false },
  workers: [
    { taskQueue: 'long-tail', workflow: reviewContent.reviewContent },
    { taskQueue: 'long-tail-verify', workflow: verifyDocument.verifyDocument },
  ],
  telemetry: process.env.HONEYCOMB_API_KEY
    ? { honeycomb: { apiKey: process.env.HONEYCOMB_API_KEY } }
    : undefined,
  events: process.env.NATS_URL
    ? { nats: { url: process.env.NATS_URL } }
    : undefined,
  logging: { pino: { level: 'info' } },
});
```

The worker container needs no inbound network access. It connects outbound to PostgreSQL (and optionally NATS, Honeycomb, etc.) and polls task queues via the HotMesh engine.

## Architecture Diagram

```
                    ┌──────────────────────────────────┐
                    │          Load Balancer           │
                    └───────────────┬──────────────────┘
                                    │
                    ┌───────────────▼───────────────────┐
                    │       API Containers (N)          │
                    │                                   │
                    │  start({ server, database })      │
                    │  Embedded Express + Auth + Routes │
                    │  No workers, no interceptors      │
                    └───────────────┬───────────────────┘
                                    │
                    ┌───────────────▼──────────────────┐
                    │          PostgreSQL              │
                    │                                  │
                    │  Workflow state (HotMesh)        │
                    │  lt_tasks, lt_escalations        │
                    │  lt_users, lt_config_*           │
                    └───────────────▲──────────────────┘
                                    │
                    ┌───────────────┴──────────────────┐
                    │     Worker Containers (M)        │
                    │                                  │
                    │  start({ workers, telemetry })   │
                    │  Workflow execution + activities │
                    │  Telemetry, events, maintenance  │
                    │  No HTTP, no public ingress      │
                    └──────────────────────────────────┘
```

API containers and worker containers scale independently. N and M need not be equal.

## AWS ECS

Two ECS services in one cluster, both in the same VPC with access to the same RDS PostgreSQL instance.

### API service

- Fargate or EC2 launch type
- Attached to an Application Load Balancer (ALB) target group
- Health check: `GET /health`
- Auto-scaling policy: target tracking on `RequestCountPerTarget`
- Security group: allow inbound 443 from ALB, outbound 5432 to RDS

### Worker service

- Fargate or EC2 launch type
- **No target group** — no inbound traffic
- Auto-scaling policy: step scaling on a custom CloudWatch metric for queue depth, or target tracking on CPU utilization
- Security group: outbound 5432 to RDS, outbound 443 to Honeycomb/NATS as needed, no inbound rules

### Task definitions

Both task definitions use the same Docker image. The difference is the `command` override:

```json
// API task definition
{
  "containerDefinitions": [{
    "command": ["node", "dist/api.js"],
    "portMappings": [{ "containerPort": 3000 }]
  }]
}

// Worker task definition
{
  "containerDefinitions": [{
    "command": ["node", "dist/worker.js"]
  }]
}
```

### RDS

- PostgreSQL 15+ (gen_random_uuid requires pgcrypto or Postgres 13+)
- Multi-AZ for production
- Both services connect via the same `DATABASE_URL` endpoint

## GCP Cloud Run

### API service

```bash
gcloud run deploy long-tail-api \
  --image gcr.io/PROJECT/long-tail:latest \
  --command node,dist/api.js \
  --port 3000 \
  --allow-unauthenticated \
  --add-cloudsql-instances PROJECT:REGION:INSTANCE \
  --set-env-vars DATABASE_URL=...,JWT_SECRET=...
```

### Worker service

```bash
gcloud run deploy long-tail-workers \
  --image gcr.io/PROJECT/long-tail:latest \
  --command node,dist/worker.js \
  --no-allow-unauthenticated \
  --min-instances 1 \
  --add-cloudsql-instances PROJECT:REGION:INSTANCE \
  --set-env-vars DATABASE_URL=...,HONEYCOMB_API_KEY=...
```

Workers need `--min-instances 1` (or higher) because they must stay warm to poll task queues. Cloud Run scales to zero by default, which would stop all workflow processing.

### GKE alternative

For more control over scaling, use two Kubernetes Deployments in the same cluster:

```yaml
# api-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: long-tail-api
spec:
  replicas: 2
  template:
    spec:
      containers:
        - name: api
          image: gcr.io/PROJECT/long-tail:latest
          command: ["node", "dist/api.js"]
          ports:
            - containerPort: 3000
---
# worker-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: long-tail-workers
spec:
  replicas: 3
  template:
    spec:
      containers:
        - name: worker
          image: gcr.io/PROJECT/long-tail:latest
          command: ["node", "dist/worker.js"]
```

The API Deployment sits behind a Service + Ingress. The worker Deployment has no Service — it only makes outbound connections.

## Environment Variables

| Variable | API | Worker | Description |
|----------|:---:|:------:|-------------|
| `DATABASE_URL` | yes | yes | PostgreSQL connection string |
| `PORT` | yes | — | HTTP listen port (default: 3000) |
| `JWT_SECRET` | yes | — | Secret for verifying and signing JWTs |
| `HONEYCOMB_API_KEY` | — | yes | Honeycomb telemetry (optional) |
| `HMSH_TELEMETRY` | — | yes | Span verbosity: `info` or `debug` |
| `NATS_URL` | — | yes | NATS server for milestone events (optional) |
| `OPENAI_API_KEY` | — | yes | For workflows that call OpenAI (optional) |

Environment variables serve as fallbacks. When using `start()`, prefer passing config directly — it's explicit and type-checked. The API container does not need telemetry, event, or AI keys — it never executes workflow code. The worker container does not need `JWT_SECRET` or `PORT` — it never serves HTTP.

## Docker

A single Dockerfile with different `CMD` targets:

```dockerfile
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./

# Override CMD at deploy time:
#   API:    ["node", "dist/api.js"]
#   Worker: ["node", "dist/worker.js"]
CMD ["node", "dist/api.js"]
```

For local development, docker-compose runs both roles in a single container:

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: longtail
      POSTGRES_PASSWORD: password
    ports:
      - "${LT_PG_PORT:-5432}:5432"

  app:
    build: .
    command: node dist/index.js   # combined API + workers
    environment:
      DATABASE_URL: postgres://postgres:password@postgres:5432/longtail
      JWT_SECRET: dev-secret
    ports:
      - "${LT_PORT:-3000}:3000"
    depends_on:
      - postgres
```

The combined `index.js` entry point (used in development and the demo) calls `start()` with both server and workers enabled. In production, split them into `api.js` and `worker.js` with different `start()` configs.

## PostgreSQL Performance Tuning

HotMesh's durable execution model is write-heavy. Every workflow creates a `jobs` row, and every field mutation creates rows in `jobs_attributes`. A simple 3-step workflow generates ~100 attribute rows per execution. At 1,000 concurrent workflows, that's 300K+ inserts in seconds.

The default Postgres configuration is tuned for mixed workloads on modest hardware. For Long Tail, the write-heavy profile needs specific adjustments.

### Determining Your Profile

Run a baseline throughput test to understand your bottleneck:

```bash
# Submit 100 minimal workflows, measure submit rate
time for i in $(seq 1 100); do
  curl -s -X POST http://localhost:3000/api/workflows/basicEcho/invoke \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d '{"data":{"message":"test","sleepSeconds":0}}' > /dev/null
done
```

Then check where Postgres is spending time:

```sql
-- Check for write pressure (high buffers_checkpoint = WAL bottleneck)
SELECT * FROM pg_stat_bgwriter;

-- Check for connection saturation
SELECT count(*) as active, max_conn
FROM pg_stat_activity, (SELECT setting::int as max_conn FROM pg_settings WHERE name = 'max_connections') mc
WHERE state = 'active'
GROUP BY max_conn;

-- Check table bloat after burst writes
SELECT relname, n_live_tup, n_dead_tup,
       round(100.0 * n_dead_tup / nullif(n_live_tup + n_dead_tup, 0), 1) as dead_pct
FROM pg_stat_user_tables
WHERE n_live_tup > 1000
ORDER BY n_dead_tup DESC LIMIT 10;
```

### Recommended Settings

| Parameter | Default | Recommended | Why |
|-----------|---------|-------------|-----|
| `shared_buffers` | 128MB | 25% of RAM (256MB–1GB) | Cache hot pages — `jobs_attributes` partitions are read/written constantly |
| `work_mem` | 4MB | 16MB | Workflow queries join across partitions; larger sort memory avoids disk spills |
| `maintenance_work_mem` | 64MB | 128MB–256MB | Speeds VACUUM on large `jobs_attributes` tables after burst writes |
| `wal_buffers` | -1 (auto) | 16MB | Write-heavy workloads saturate the default 8MB WAL buffer |
| `max_wal_size` | 1GB | 1GB–2GB | Prevents excessive checkpointing during sustained write bursts |
| `checkpoint_completion_target` | 0.9 | 0.9 | Spread checkpoint I/O over time — already optimal |
| `effective_cache_size` | 4GB | 50–75% of RAM | Query planner hint — tells Postgres how much OS cache to expect |
| `synchronous_commit` | on | off (dev/staging) | Trades durability for 2–5x write throughput. WAL is still written; only fsync is deferred. Acceptable for dev and staging. **Keep `on` in production** unless you understand the trade-off. |
| `max_connections` | 100 | 200 | HotMesh uses connection-per-worker; concurrent workflows can exhaust 100 connections |

### Docker Compose Configuration

```yaml
postgres:
  image: postgres:16
  command:
    - postgres
    - -c
    - shared_buffers=256MB
    - -c
    - work_mem=16MB
    - -c
    - maintenance_work_mem=128MB
    - -c
    - wal_buffers=16MB
    - -c
    - max_wal_size=1GB
    - -c
    - checkpoint_completion_target=0.9
    - -c
    - effective_cache_size=512MB
    - -c
    - synchronous_commit=off
    - -c
    - max_connections=200
  shm_size: 512m    # Required: shared_buffers > 128MB needs larger /dev/shm
```

The `shm_size` setting is critical — Docker defaults to 64MB for `/dev/shm`, but `shared_buffers=256MB` requires at least that much shared memory. Without it, Postgres will fail to start or silently fall back to smaller buffers.

### Production (RDS / Cloud SQL)

For managed databases, apply the same parameters through parameter groups:

**AWS RDS:**
```
# Custom parameter group
shared_buffers = {DBInstanceClassMemory/4}
work_mem = 16384          # 16MB in KB
maintenance_work_mem = 262144
wal_buffers = 16384
max_wal_size = 2048       # 2GB in MB
synchronous_commit = on   # Keep on for production
max_connections = 200
```

**GCP Cloud SQL:**
```
# Database flags
shared_buffers: 25% of instance RAM (auto-tuned by Cloud SQL)
work_mem: 16MB
maintenance_work_mem: 256MB
max_wal_size: 2GB
synchronous_commit: on
max_connections: 200
```

### Maintenance

After burst workloads, dead tuples accumulate in `jobs_attributes`. Autovacuum handles this, but for large bursts (10K+ workflows), consider:

```sql
-- Manual VACUUM after a load test or batch run
VACUUM ANALYZE durable.jobs_attributes;
VACUUM ANALYZE durable.engine_streams;
```

Long Tail includes a built-in maintenance cron that prunes completed workflow data. Configure it via the dashboard or API to keep table sizes manageable.
