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
