# Surfacing Any API

## The Gap Between Plumbing and Domain

Long Tail ships with built-in MCP servers. Browser automation for navigating web interfaces. File storage for persisting artifacts. Vision for analyzing images. Knowledge for accumulating structured state. An admin server for the platform to look inward — list its own workflows, manage its own configuration, query its own execution history.

These are plumbing. They solve cross-cutting problems that every deployment shares. But they don't know anything about your domain. They don't know what Epic's FHIR API returns for a `ServiceRequest` resource. They don't know the shape of Stripe's charge response. They don't know that your internal inventory service returns `{ items: [...], cursor: string }` and paginates with cursor-based tokens.

Traditionally, closing this gap meant writing an MCP server. Define the tools. Map each one to an API call. Handle serialization, error cases, pagination. Register the server. Tag it. Write compile hints so the builder knows how to wire it. A week of engineering per external service.

The schema-exchange primitive eliminates that week.

---

## The Principle: Endpoint + Schema

The `exchange` tool doesn't know HTTP from Playwright. It knows three things: where to send data, what the data should look like going out, and what it should look like coming back.

```
endpoint:        where
request_schema:  what leaves
response_schema: what returns
```

Transport is an implementation detail. Today it's Node.js `fetch`. Tomorrow it could be a browser automation step that fills a form, submits, and scrapes the result. Or a gRPC call. Or a SOAP envelope. The consumer doesn't know and doesn't care.

What the consumer gets is a contract. The request is validated before it leaves the system. The response is validated when it arrives. If either validation fails, the failure is structural and specific — "the response is missing the `resourceType` field" — not a vague 500 error three layers deep.

This is the difference between a fetch call and a schema-driven exchange. A fetch call succeeds or fails. An exchange succeeds, fails, or *detects drift* — the call succeeded but the shape changed. That third state is what makes API integrations maintainable over time.

---

## From Spec to Toolset

Open the Pipeline Designer. Choose Build mode. Paste:

```
Stripe Charges API (base: https://api.stripe.com/v1)

POST /charges
  Headers: Authorization: Bearer {api_key}
  Request: { amount: number, currency: string, source: string, description?: string }
  Response: { id: string, amount: number, currency: string, status: string, created: number }

GET /charges/{id}
  Headers: Authorization: Bearer {api_key}
  Response: { id: string, amount: number, currency: string, status: string, created: number }
```

The planner decomposes this into two leaf tools. The builder discovers the `exchange` tool in its inventory, reads the compile hints, and constructs each workflow:

- **`create_charge`** — trigger accepts `api_key`, `amount`, `currency`, `source`. Worker calls `exchange` with the request schema embedded as a static value. Response schema validates the charge object. If Stripe changes the response shape, `validated` flips to `false` and the error names the exact field that changed.

- **`get_charge`** — trigger accepts `api_key`, `charge_id`. Worker calls `exchange` with the charge ID interpolated into the URL. Response schema validates the same shape.

Both deploy under a server namespace: `stripe`. They're compiled, versioned, invocable. They have typed inputs and outputs. They compose into larger workflows — a refund pipeline, an invoicing process, a reconciliation job.

The engineer didn't write an MCP server. They didn't write any code. They pasted two endpoint descriptions and got two schema-validated tools that will catch API drift the moment Stripe changes a field.

---

## Schema Drift: The Silent Killer

APIs change. Fields get renamed. Required properties appear. Types shift from strings to objects. These changes are rarely announced in time, rarely caught by tests that don't run against live endpoints, and rarely surfaced until a downstream consumer produces wrong results.

The response schema embedded in each compiled tool is a contract. It doesn't enforce — it detects. When the contract breaks, the tool reports exactly what changed:

```
response: (root): must have required property 'source' ({"missingProperty":"source"})
```

Not "API error." Not "unexpected response." The structural diff, in human-readable text, identifying the exact field.

Schedule the tool on cron against a staging or dev endpoint. Every midnight, it calls the API and validates the response. If the schema matches, nothing happens. If it doesn't, the system knows before production does. The team fixes the tool, updates the schema, redeploys. No customer impact.

This is what makes compiled API tools self-maintaining. The schema is both the integration logic and the regression test. They're the same artifact.

---

## The Request Gate

Schema enforcement works in both directions. The request schema validates outbound data before it leaves the system. If a caller passes `{ amount: "fifty" }` to `create_charge`, the exchange tool rejects it immediately:

```
request: /amount: must be number ({"type":"number"})
```

The request never hits Stripe. The error is instant, specific, and local. No network round-trip. No API rate limit consumed. No partial state created on the remote service.

This matters in compiled workflows where one tool's output feeds another's input. A data-mapping error in step 3 of a 7-step pipeline is caught at step 3, not when Stripe returns a 400 in step 5. The failure is close to the cause.

---

## Growing a Toolset

The Pipeline Designer organizes tools into sets — collections of related tools that share a namespace and evolve together. You start with two Stripe endpoints. Next week you add `list_charges` and `create_refund`. The following month, `get_balance` and `list_payouts`.

Each addition goes through the same flow: paste the spec, the planner builds the tool, it deploys into the existing namespace. The server version increments. All tools in the namespace are redeployed together. Active workflows don't stop — the new version activates atomically.

The set is the workbench. It preserves the full specification history — every endpoint description that was pasted, in order. It's the source of truth for what the toolset covers and how it evolved.

Over time, the set becomes a complete API surface. Not hand-written bindings. Not auto-generated client code that drifts from the spec. Compiled tools with embedded schemas that validate on every call.

---

## Composition: Tools Built From Tools

Individual API tools are building blocks. A compiled tool that calls `create_charge` can be composed with one that calls `get_customer` and one that calls `send_receipt`. The composition is itself a compiled tool — a pipeline that executes the three steps in sequence, wiring the charge ID from step 1 to the receipt in step 3.

The schema exchange is invisible at the composition level. The composer sees tools with typed inputs and outputs. It doesn't know — or need to know — that these tools validate their data against schemas before every call. The validation is infrastructure, not application logic.

This is where the Epic story begins. The FHIR endpoints are individual tools — `get_patient`, `search_coverage`, `create_task`. Each validates its request and response. Linda's intake process composes them into a pipeline that encodes her institutional knowledge: which checks to run, in what order, with what branching logic. The individual tools handle the API contract. The composition handles the business process. Neither knows about the other's concerns.

---

## What This Replaces

Without schema-driven exchange, wrapping an external API requires:

1. Writing an MCP server (TypeScript, tool definitions, error handling)
2. Registering it with the platform
3. Writing compile hints so the builder knows how to use it
4. Maintaining it when the API changes
5. Repeating for every external service

With schema-driven exchange, wrapping an external API requires:

1. Pasting the endpoint specs into the Pipeline Designer

The MCP server is the `exchange` tool. The compile hints are on the `exchange` tool. The schema validation is in the `exchange` tool. The only thing that changes per API is the spec the engineer pastes — the endpoints, the schemas, the auth pattern.

This is what makes the Epic story practical. The engineering team doesn't spend a week writing a FHIR MCP server. They paste the endpoint descriptions and get compiled tools that speak FHIR with schema enforcement. The week they would have spent on plumbing is spent with Linda instead, capturing the institutional knowledge that makes the tools valuable.

---

## The Reflexive Case

Long Tail wraps its own API using the same primitive. The platform's REST endpoints — login, list servers, list workflows — are compiled tools in the `longtailapi` namespace. They validate their own response shapes. They detect drift in their own API surface.

This isn't a special case. It's a proof point. The same `exchange` tool that wraps Epic's FHIR server wraps Long Tail's own REST API. The same schema enforcement that catches Stripe's field changes catches Long Tail's own field changes. The platform doesn't have a privileged self-knowledge path. It discovers its own capabilities the same way it discovers any external service — through endpoints and schemas.

The admin server (`long-tail-admin`) still exists for operations that require internal access — managing workflows, modifying configuration, operations that go beyond data exchange. But for anything that's "call an endpoint, validate the response, return the data" — the schema exchange primitive is the universal answer. Internal or external. FHIR or REST. Stripe or self.

---

## Identity: The Third Pillar

Endpoint and schema handle the data contract. The third pillar — identity — handles who's calling.

The `exchange` tool accepts an optional `credential_provider` field. When set, the tool resolves authentication from the platform's connection store using the calling principal's identity. No token input. No manual header wiring. No `get_access_token` step in the workflow.

```
credential_provider: "stripe"
```

That single field means: look up the calling user's Stripe credentials from the encrypted connection store, auto-refresh if expired, inject into the request headers. The credential never appears in the workflow state, the execution trace, or the YAML. It's resolved at the last mile — inside the tool execution, after the HotMesh event log has already been written.

This is how the Epic story works in practice. The engineering team registers their SMART on FHIR credentials as a connection. Every compiled FHIR tool specifies `credential_provider: "epic"`. When the tool runs for Customer A, it gets Customer A's token. When it runs for Customer B, it gets Customer B's. Same compiled tool. Different identities. The routing is invisible.

Three auth patterns, one tool:
- **credential_provider** — resolve from the connection store. Fresh token, auto-refresh, per-principal. The default for production.
- **Ephemeral references** — opaque `eph:v1:*` strings in headers, exchanged at the last mile. For workflows that need human-provided credentials with TTL.
- **Raw headers** — pass `Authorization: Bearer {token}` directly. For testing, one-off calls, or systems where the caller manages tokens externally.

---

## What Remains

The schema-exchange tool is plumbing. It doesn't know about healthcare or payments or logistics. It knows about endpoints, schemas, identity, and whether the data matched.

Everything above it — the domain knowledge, the business logic, the institutional expertise — comes from the people who use it. Linda's referral intake rules. Maria's document requirements. The Stripe integration team's charge flow. The ops team's self-monitoring pipeline.

The platform's job is to make that knowledge executable, composable, and self-testing. The schema exchange is the foundation layer — endpoint, schema, identity. The three pillars that make "paste an API spec, get a validated tool with automatic auth" possible. Everything else builds on top of it. The tools are the building. The exchange is the foundation.
