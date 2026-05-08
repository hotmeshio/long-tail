# The Self-Test: Long Tail Wraps Its Own API

## The Tool That Wanted to Extend Itself

Long Tail ships with a schema-exchange tool — a baseline capability for exchanging data with any external service under schema enforcement. The tool validates requests before sending and responses after receiving. It doesn't know HTTP from Playwright. It knows endpoints, schemas, and whether the data matched.

This is the story of what happened when someone pointed that tool at Long Tail's own API.

---

## The Starting Point

Long Tail has a REST API. It has endpoints for authentication, for listing registered MCP servers, for querying compiled workflows. Every deployment uses these endpoints — the dashboard calls them, integrations call them, crons call them.

But nobody had ever formalized what those endpoints return. The shapes were implicit — TypeScript interfaces in the codebase, but nothing the runtime could assert against. If a deployment changed a response shape, you found out when the dashboard broke. Or when a customer's integration broke. Or, worst case, you didn't find out at all because the consumer silently swallowed the new shape and produced wrong results downstream.

The schema-exchange tool exists precisely for this problem. It doesn't care whether the endpoint is Epic's FHIR server or Long Tail's own API. The principle is the same: endpoint + schema + validated exchange.

---

## Wrapping the API

An engineer opens Plan Mode in the dashboard and pastes three endpoint specifications:

```
Long Tail API (base: http://localhost:3000/api)

POST /auth/login
  Request: { username: string, password: string }
  Response: { token: string, user: { id: string, external_id: string, display_name: string, roles: [{ role: string, type: string }] } }

GET /mcp/servers (requires Bearer token)
  Response: { servers: [{ id: string, name: string, description: string, tags: string[], status: string, tool_manifest: [{ name: string, description: string }] }] }

GET /yaml-workflows (requires Bearer token)
  Response: { workflows: [{ id: string, name: string, app_id: string, status: string, graph_topic: string, tags: string[] }], total: number }
```

The planner decomposes this into three leaf workflows. The builder discovers the `exchange` tool in the inventory, reads the compile hints, and constructs each workflow as a trigger → exchange → output DAG with embedded schemas.

All three deploy under a server namespace: `longtailapi`.

---

## What the Compiled Tools Do

**`login`** — Takes a username and password. Validates the request body (both strings, both required) against the request schema before sending. Calls POST /auth/login. Validates the response (must have `token` string and `user` object with required fields). Returns the token and user profile.

If someone changes the login response — adds a field, removes `display_name`, changes `roles` from an array to a string — the schema validation catches it. `validated: false`, with a human-readable error explaining exactly what changed.

**`list_servers`** — Takes a bearer token. Calls GET /mcp/servers. Validates the response (must be an object with a `servers` array, each server must have `id`, `name`, `tags`). Returns the server list.

This tool can answer the question: "does the schema-exchange server exist?" If `long-tail-schema-exchange` isn't in the returned list, the tool that's asking the question knows its own infrastructure is broken. The snake eating its own tail.

**`list_workflows`** — Takes a bearer token. Calls GET /yaml-workflows. Validates the response (must be an object with `workflows` array and `total` number). Returns the compiled tool inventory.

This tool can check whether the `longtailapi` tools themselves are deployed and active. It can verify that the very workflows it belongs to are in the list. Self-referential validation — the compiled tool confirms its own existence.

---

## The Composition: Self-Health-Check

The three leaf tools compose into a single workflow: `self_health_check`.

1. **Login** — authenticate with a service account
2. **List servers** — verify all expected MCP servers are registered
3. **List workflows** — verify all expected compiled tools are deployed

Each step validates its response schema. If any step fails validation, the workflow knows exactly what changed — not "the API is down" but "the `servers` response is missing the `tags` field on server objects."

Schedule it on cron. Every midnight, the platform checks its own API surface against the schemas it captured when the tools were compiled. Schema drift is caught within 24 hours, automatically, without a human looking at anything.

---

## Why This Matters

This isn't a testing framework. It's the same schema-exchange primitive that wraps Epic's FHIR endpoints or Stripe's payment API or any other external service. The fact that it can wrap Long Tail's own API is a proof point, not a special case.

The proof point is:

1. **Any API surface can be formalized as compiled tools.** Paste the endpoint specs. Get schema-validated, cron-testable tools. No MCP server to hand-write. No integration code. The schema is the integration.

2. **Schema drift detection is automatic.** The response_schema embedded in each compiled tool is the contract. When the contract breaks, the tool reports exactly what changed. Not "500 error" — the actual structural diff.

3. **The tools compose.** Login → use token → check servers → check workflows. Each step is independently testable, independently schedulable, independently versionable. But together they form a health check that validates the entire platform surface.

4. **The platform can extend itself.** The schema-exchange tool is a baseline capability. The compiled API tools are built from it. The health check composes them. Every layer uses the same machinery. New endpoints are absorbed the same way — paste, compile, deploy, schedule.

This is the starting point the Epic story describes: "The engineering team registers a custom MCP server that wraps the FHIR endpoints their referral workflows need." Except here, the engineering team is us, the FHIR endpoints are our own API, and the custom MCP server assembled itself from pasted specs and a schema-exchange primitive.

The SOPs come next. But the plumbing works.

---

## The Integration Test

The file `tests/integration/schema-exchange.test.ts` proves this end-to-end:

1. Calls `exchange` to login (POST /auth/login with request + response schema)
2. Calls `exchange` to list servers (GET /mcp/servers with response schema)
3. Asserts the schema-exchange server exists in the response
4. Calls `exchange` to list workflows (GET /yaml-workflows with response schema)
5. Deliberately uses a wrong schema to prove drift detection
6. Deliberately sends a malformed request to prove pre-send rejection

If any assertion fails, the schema-exchange tool isn't doing its job. If they all pass, the platform can wrap any API — including its own.
