# MCP Guide

Your agents speak MCP. Long Tail makes their tool calls durable and exposes human escalation as an MCP server — the same protocol your agent uses to call any other tool. Both sides of a workflow — AI processing and human review — communicate through MCP.

## Contents

- [Everything is a Tool](#everything-is-a-tool)
    - [Humans as Tools](#humans-as-tools)
    - [Compiled Workflows as Tools](#compiled-workflows-as-tools)
    - [The Cycle](#the-cycle)
- [Human Queue Server](#human-queue-server) — escalation as MCP tools
- [Document Vision Server](#document-vision-server) — AI tools as 3 MCP tools
- [MCP-Native Workflow](#mcp-native-workflow) — both sides MCP, end to end
- [Server Registration Lifecycle](#server-registration-lifecycle) — two paths, startup sequence, when things connect
- [External MCP Servers](#external-mcp-servers) — Path B: dashboard/API registration
- [Built-in Servers](#built-in-servers) — servers that ship by default
- [Configuration](#configuration)
- [REST API](#rest-api) — server registration and management
- [Database Schema](#database-schema)
- [Testing](#testing) — InMemoryTransport and functional tests
- [Custom Adapters](#custom-adapters)

## Everything is a Tool

Everything is a tool. Every proxy activity — the functions that workflows call — is an MCP tool. Every collection of related tools is an MCP server. When an engineer writes a workflow, they're composing tool calls. When the triage agent fixes an edge case, it's calling the same tools. When that fix gets compiled into a deterministic pipeline, it becomes a new tool on a new server.

The protocol is the same whether the caller is deterministic code, an LLM, or a human clicking a button.

A proxy activity is a function that runs outside the deterministic sandbox — it makes an API call, queries a database, calls an LLM. HotMesh checkpoints the result. If the process crashes, it replays from cache. The activity isn't called twice.

Every one of these activities is also an MCP tool. Register an MCP server and its tools become proxy activities automatically:

```typescript
import { Durable } from '@hotmeshio/hotmesh';
import { McpClient } from '@hotmeshio/long-tail';

const tools = await McpClient.toolActivities(serverId);
const { mcp_analyzer_classify } = Durable.workflow.proxyActivities<typeof tools>({
  activities: tools,
});

export async function classifyDocument(envelope: LTEnvelope) {
  const result = await mcp_analyzer_classify({ content: envelope.data.content });

  if (result.confidence >= 0.85) {
    return { type: 'return', data: result };
  }
  return { type: 'escalation', data: result, message: 'Low confidence', role: 'reviewer' };
}
```

The engineer writes `await mcp_analyzer_classify(...)` in their workflow. That's a proxy activity call. It's also an MCP tool call. Same thing. Durable, checkpointed, exactly-once. The engineer doesn't need to think about protocols — they call functions. The system handles the rest.

### Humans as Tools

Long Tail exposes its escalation queue as an MCP server. Any MCP-aware agent can route work to humans through the same protocol it uses to call any other tool.

```
MCP Server: "long-tail-human-queue"

Tools:
  - escalate_to_human(role, message, data)   → escalation_id
  - escalate_and_wait(role, message, data)   → blocks until resolved, returns payload
  - check_resolution(escalation_id)          → resolved | pending
  - get_available_work(role)                 → escalation[]
  - claim_and_resolve(escalation_id, payload) → result
```

An AI agent working the queue:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client';

const client = new Client({ name: 'my-agent', version: '1.0.0' });
await client.connect(transport);

const work = await client.callTool({
  name: 'get_available_work',
  arguments: { role: 'reviewer' },
});

await client.callTool({
  name: 'claim_and_resolve',
  arguments: {
    escalation_id: 'esc-abc123',
    resolver_id: 'my-agent',
    payload: { approved: true, note: 'Verified by automated review' },
  },
});
```

Human labor and AI labor become composable. The protocol is the same whether the resolver is a person clicking a button or an agent calling a tool.

### Compiled Workflows as Tools

Once a triage execution is compiled and deployed, it becomes a tool. The dynamic sequence of tool calls that fixed an edge case — rotate, extract, validate — is now a deterministic pipeline that any workflow or agent can invoke:

```
MCP Server: "long-tail-mcp-workflows"

Tools:
  - list_workflows()                              → available compiled workflows
  - get_workflow(workflow_name)                    → schema, manifest, provenance
  - invoke_workflow(workflow_name, input, async?)  → result or job_id
```

An agent encountering a familiar edge case checks for a compiled solution before falling back to dynamic triage:

```typescript
const available = await client.callTool({
  name: 'list_workflows',
  arguments: { status: 'active' },
});

await client.callTool({
  name: 'invoke_workflow',
  arguments: {
    workflow_name: 'rotate-and-extract',
    input: { document: 'page1_upside_down.png', rotation: 180 },
  },
});
```

No LLM needed. No token costs. The same fix that once required an agentic reasoning loop now runs as a direct tool-to-tool pipeline — and it's callable as a single tool by any other workflow.

### The Cycle

This is how the system evolves:

```
1. Engineer writes workflow, calling tools (proxy activities)
2. Workflow escalates when confidence is low
3. Human resolves — or flags for triage
4. Triage agent calls the SAME tools dynamically to fix the issue
5. Successful fix is compiled into a deterministic workflow
6. That workflow becomes a new tool on a new server
7. Next time, the deterministic workflow handles it — no LLM, no human
8. The triage agent discovers it has one more tool available
```

Over time, the YAML replaces the procedural. The MCP triage workflow stops entropy by repairing and replacing the flows that eventually all become obsolete. Dynamic processes author themselves. The long tail gets shorter every time.

The sections above describe the concept. The rest of this guide covers the concrete servers, tools, and APIs that implement it.

## Human Queue Server

The Human Queue is a built-in MCP server that exposes Long Tail's escalation API as standard MCP tools. Any MCP-compatible client — Claude, LangGraph, CrewAI, a custom agent — can connect and work the queue.

### Tools

#### `escalate_to_human`

Create a new escalation for human review.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `role` | string | yes | Target role (e.g., `"reviewer"`) |
| `message` | string | yes | What needs human review |
| `data` | object | no | Contextual data for the reviewer |
| `type` | string | no | Classification (default: `"mcp"`) |
| `subtype` | string | no | Subtype (default: `"tool_call"`) |
| `priority` | number | no | 1 (highest) to 4 (lowest), default: 2 |

Returns:

```json
{
  "escalation_id": "uuid",
  "status": "pending",
  "role": "reviewer",
  "created_at": "2025-01-15T10:30:00Z"
}
```

#### `check_resolution`

Check the status of an escalation.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `escalation_id` | string | yes | The escalation ID to check |

Returns:

```json
{
  "escalation_id": "uuid",
  "status": "pending"
}
```

When resolved:

```json
{
  "escalation_id": "uuid",
  "status": "resolved",
  "resolver_payload": { "approved": true, "note": "..." },
  "resolved_at": "2025-01-15T11:00:00Z"
}
```

Returns `isError: true` if the escalation doesn't exist.

#### `get_available_work`

List pending, unassigned escalations for a role.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `role` | string | yes | Role to filter by |
| `limit` | number | no | Max results (default: 10) |

Returns:

```json
{
  "count": 2,
  "escalations": [
    {
      "escalation_id": "uuid",
      "type": "mcp",
      "subtype": "tool_call",
      "description": "Address mismatch for MBR-2024-001",
      "priority": 2,
      "role": "reviewer",
      "created_at": "2025-01-15T10:30:00Z"
    }
  ]
}
```

#### `claim_and_resolve`

Claim an escalation and resolve it in one atomic operation.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `escalation_id` | string | yes | The escalation to resolve |
| `resolver_id` | string | yes | Who/what is resolving (e.g., `"my-agent"`) |
| `payload` | object | yes | Resolution data |

Returns:

```json
{
  "escalation_id": "uuid",
  "status": "resolved",
  "resolved_at": "2025-01-15T11:00:00Z"
}
```

Returns `isError: true` if the escalation isn't available (already claimed, already resolved, or doesn't exist).

### Connecting

**In-process (testing or co-located agents):**

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createHumanQueueServer } from '@hotmeshio/long-tail/services/mcp/server';

const server = await createHumanQueueServer();
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);

const client = new Client({ name: 'my-agent', version: '1.0.0' });
await client.connect(clientTransport);

// Now use client.callTool() to interact with the queue
const work = await client.callTool({
  name: 'get_available_work',
  arguments: { role: 'reviewer', limit: 50 },
});
```

**Over stdio or SSE:** Connect your MCP client to Long Tail's Streamable HTTP endpoint or spawn the server as a subprocess. The tools and responses are identical regardless of transport.

The Human Queue handles the people side. The Document Vision server handles the AI side — wrapping model capabilities as MCP tools.

## Document Vision Server

The Document Vision server (`services/mcp/vision-server.ts`) wraps AI processing activities as MCP tools. It follows the same singleton pattern as the Human Queue server — Zod schemas at module level, `createVisionServer()` / `stopVisionServer()` lifecycle.

The included implementation wraps OpenAI Vision extraction and member database validation. The pattern applies to any AI capability you want to expose as MCP tools.

### Tools

| Tool | Arguments | Returns |
|------|-----------|---------|
| `list_document_pages` | *(none)* | `{ pages: string[] }` |
| `extract_member_info` | `{ image_ref, page_number }` | `{ member_info: MemberInfo \| null }` |
| `validate_member` | `{ member_info: MemberInfo }` | `{ result, databaseRecord? }` |

### Connecting

Same `InMemoryTransport` pattern as the Human Queue:

```typescript
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createVisionServer } from '@hotmeshio/long-tail/services/mcp/vision-server';

const server = await createVisionServer();
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);

const client = new McpClient({ name: 'my-vision-client', version: '1.0.0' });
await client.connect(clientTransport);

// Discover tools
const { tools } = await client.listTools();

// Call a tool
const result = await client.callTool({
  name: 'list_document_pages',
  arguments: {},
});
```

### Writing Your Own MCP Server

To wrap your own AI capabilities as MCP tools, follow the same pattern:

1. Define Zod schemas at module level (avoids TS2589 deep inference errors)
2. Use the singleton pattern with `create` / `stop` lifecycle
3. Register tools with `(server as any).registerTool()` (type cast required by SDK)

See `services/mcp/vision-server.ts` and `services/mcp/server.ts` for working examples.

## MCP-Native Workflow

The `verify-document-mcp` workflow demonstrates both MCP servers working together. Every activity call — listing pages, extracting data, validating members — routes through the Vision MCP server. When the workflow escalates, the Human Queue MCP server manages the review cycle. Both sides speak the same protocol.

### How It Works

```
verify-document-mcp workflow
  |
  +-- proxyActivities --> MCP client -- InMemoryTransport --> Vision MCP Server
  |                                                            +- list_document_pages
  |                                                            +- extract_member_info (-> OpenAI Vision)
  |                                                            +- validate_member (-> member DB)
  |
  +-- return { type: 'escalation' }
       |
       +-- interceptor --> Human Queue MCP Server
                            +- check_resolution
                            +- get_available_work
                            +- claim_and_resolve
```

### The Activity Wrapper Pattern

The key insight: MCP tool calls are wrapped as activities with the **same function signatures** as direct implementations. The workflow doesn't know (or care) that MCP is underneath — it just calls `extractMemberInfo()`. But each call routes through the MCP protocol, making every AI tool invocation protocol-native.

```typescript
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createVisionServer } from '../../services/mcp/vision-server';

let client: McpClient | null = null;

async function getClient(): Promise<McpClient> {
  if (client) return client;
  const server = await createVisionServer();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  client = new McpClient({ name: 'verify-mcp-client', version: '1.0.0' });
  await client.connect(ct);
  return client;
}

export async function extractMemberInfo(
  imageRef: string,
  pageNumber: number,
): Promise<MemberInfo | null> {
  const c = await getClient();
  const result = await c.callTool({
    name: 'extract_member_info',
    arguments: { image_ref: imageRef, page_number: pageNumber },
  });
  return parseResult(result).member_info;
}
```

Because the signatures match the original activities, the workflow uses `proxyActivities()` at module scope — the standard pattern. Each proxied call is a durable checkpoint. If the process crashes after a Vision MCP tool call completes, replay uses the cached result.

### The Pipeline

1. **List pages** via MCP tool `list_document_pages`
2. **Extract** member info from each page via MCP tool `extract_member_info` (routes to OpenAI Vision)
3. **Merge** multi-page extractions into a single record
4. **Validate** against member database via MCP tool `validate_member`
5. **Return or escalate** — match returns; mismatch escalates to the Human Queue

When the workflow escalates, agents can query and resolve the escalation through the Human Queue MCP server — the same protocol used for the AI tools.

### Running the Tests

```bash
# Vision server tool tests (no OpenAI key needed for most)
npm run test:mcp:vision

# Full integration (needs OpenAI key for extraction + workflow tests)
OPENAI_API_KEY=sk-... npm run test:mcp:vision

# With verbose output
npx vitest run tests/workflows/verify-document-mcp.test.ts --reporter=verbose
```

The examples above use built-in servers. Long Tail can also connect to any external MCP server.

## Server Registration Lifecycle

When you add an MCP server to Long Tail, two things must happen: the server must be **registered** (so the system knows it exists) and **connected** (so tools are callable). There are two paths depending on where your server runs.

### Path A: In-Process (serverFactories)

Your MCP server runs inside the Long Tail process. You pass a factory function at startup. The server connects lazily on first tool call via `InMemoryTransport` — no network, no subprocess.

```typescript
import { start } from '@hotmeshio/long-tail';

const lt = await start({
  database: { connectionString: process.env.DATABASE_URL },
  mcp: {
    serverFactories: {
      'my-classifier': () => import('./mcp-servers/classifier').then(m => m.createServer()),
    },
  },
});
```

Your factory is registered alongside the built-in factories. On first tool call, `resolveClient()` invokes the factory, creates an `InMemoryTransport` pair, connects, and caches the client. Subsequent calls reuse the cached connection.

To make this server visible in the dashboard and discoverable by tag-based workflows, seed a DB row for it (same pattern as the built-in servers) or register it via the API after startup.

This is the path all built-in servers use. It's the right choice when:
- Your server needs access to in-process state (DB pool, caches, other services)
- You want zero-latency tool calls (no IPC or network overhead)
- The server ships as part of your application code

### Path B: External (Dashboard or API)

Your MCP server runs as a separate process (stdio) or remote service (SSE/Streamable HTTP). You register it via the dashboard wizard or REST API. The system stores the registration in `lt_mcp_servers` and connects via the configured transport.

This is the path for:
- npm MCP server packages (e.g., `@modelcontextprotocol/server-filesystem`)
- Remote servers running on other machines
- Servers you want operators to add without redeploying

### Startup Sequence

Here's what happens when Long Tail boots, and where each path fits:

```
1. migrate()                  — DB tables created (lt_mcp_servers exists)
2. Start HotMesh workers      — Workflow engines ready
3. mcpRegistry.connect()      — Human queue server starts
   └─ connectAutoServers()    — External servers with auto_connect=true connect now
4. registerBuiltinServer()    — All factories stored (system + your serverFactories)
5. seedSystemMcpServers()     — Built-in servers upserted to lt_mcp_servers
6. HTTP server starts         — Dashboard and API available
7. First tool call            — Factory lazily connected via resolveClient()
```

**Path A factories** are registered at step 4 and connected lazily at step 7. They don't need a DB row to function — `resolveClient()` finds them by name in the factory Map. But adding a DB row (step 5 or via API after step 6) makes them visible in the dashboard and discoverable by tag-based workflows.

**Path B servers** are stored in the DB (via API at step 6 or pre-seeded). If `auto_connect` is true, they connect at step 3. Otherwise, they connect on demand via `POST /api/mcp/servers/:id/connect` or lazily on first tool call.

### Choosing a Path

| Consideration | Path A (in-process) | Path B (external) |
|---------------|--------------------|--------------------|
| Server location | Same process | Separate process or remote |
| Connection | InMemoryTransport (zero latency) | stdio / SSE / Streamable HTTP |
| Registration | `serverFactories` in startup config | Dashboard wizard or REST API |
| Deployment | Ships with your app code | Independent lifecycle |
| Access to app state | Yes (DB pool, caches, services) | No (isolated process) |
| Visibility in dashboard | Needs a DB row (seed or API) | Automatic (stored in DB) |

Both paths produce the same outcome: tools callable as durable activities via `proxyActivities()`.

## External MCP Servers

This section covers [Path B](#path-b-external-dashboard-or-api) — registering servers via the dashboard or API. For in-process servers, see [Path A](#path-a-in-process-serverfactories) above.

Every registration uses the same data model. The dashboard wizard and the REST API are interchangeable views of that data.

### The Registration Data Model

A server registration is a record with these fields. The dashboard wizard collects them across four steps; the API accepts them as a single JSON payload. Same data, two interfaces.

| Field | API field | Wizard step | Description |
|-------|-----------|-------------|-------------|
| Name | `name` | Transport | Unique identifier for the server |
| Description | `description` | Transport | What this server does |
| Transport type | `transport_type` | Transport | `stdio`, `sse`, or `streamable-http` |
| Transport config | `transport_config` | Transport | Connection details — command/args/env for stdio, url for network |
| Auto-connect | `auto_connect` | Transport | Start the connection when Long Tail boots |
| Tags | `tags` | Discovery | Categorize for tool discovery (e.g., `["database", "analytics"]`) |
| Compile hints | `compile_hints` | Discovery | Guidance for the workflow compiler |
| Credential providers | `credential_providers` | Discovery | IAM providers required by tools (e.g., `["github", "openai"]`) |

The wizard's **Test** step calls `POST /api/mcp/servers/test-connection` with the transport fields, and the **Review** step shows the full payload before saving.

#### Dashboard → API mapping

Each wizard step maps directly to API fields:

**Step 1 — Transport.** The mode cards select `transport_type` and determine which `transport_config` fields appear:

| Mode | `transport_type` | `transport_config` |
|------|------------------|--------------------|
| Local Process | `stdio` | `{ "command": "...", "args": [...], "env": {...} }` |
| Network Service (SSE) | `sse` | `{ "url": "..." }` |
| Network Service (Streamable HTTP) | `streamable-http` | `{ "url": "..." }` |
| In-Process | *(managed by the system)* | *(read-only for built-in servers)* |

**Step 2 — Discovery.** Maps directly to `tags`, `compile_hints`, and `credential_providers`.

**Step 3 — Test.** Calls the test-connection endpoint. No data is persisted.

**Step 4 — Review.** Shows the assembled payload. Save calls `POST /api/mcp/servers` (create) or `PUT /api/mcp/servers/:id` (edit).

#### When to use each field

| Field | When to use |
|-------|-------------|
| **Tags** | Always. Good tags make tools discoverable. Workflows like `mcpQuery` filter servers by tags. Use lowercase, hyphenated (e.g., `database`, `image-analysis`). |
| **Compile hints** | When the workflow compiler needs to know about tool ordering, timeouts, retry behavior, or output formats. |
| **Credential providers** | When tools call external APIs that need user-specific credentials. Users are prompted to connect via the Credentials page before tool execution. |
| **Auto-connect** | For servers you always want available. Skip for infrequently used servers. |

### How to Register: Three Scenarios

The registration data model is the same in all three scenarios. Only the transport config differs.

#### Scenario 1: npm MCP Server Package

Many MCP servers are published to npm (`@modelcontextprotocol/server-filesystem`, `@modelcontextprotocol/server-github`, `mcp-server-sqlite`). No wrapper code needed — install the package and register.

There are two binding strategies:

**Early-bound (production)** — install as a dependency, ship in the Docker image:

```bash
npm install @modelcontextprotocol/server-filesystem
```

```json
{
  "transport_type": "stdio",
  "transport_config": {
    "command": "node",
    "args": ["node_modules/@modelcontextprotocol/server-filesystem/dist/index.js", "/data"]
  }
}
```

The package is in `package.json`, locked by `package-lock.json`, built into the image. Deterministic, auditable, no network call at runtime.

**Late-bound (exploration)** — pull on demand via `npx`:

```json
{
  "transport_type": "stdio",
  "transport_config": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/data"]
  }
}
```

The package isn't in your repo, lockfile, or Docker image. It's resolved at runtime — downloaded on first spawn, cached for subsequent connections. Useful for trying out a server without committing to a dependency, or environments where operators add servers without redeploying.

Long Tail serves as the registry that decides which servers to connect, when to spawn them, and how they wire into workflows. The binding strategy is a transport detail.

**Dashboard:** Select **Local Process**, enter the command and args, walk through Discovery/Test/Review.

**API:**

```bash
curl -X POST http://localhost:3000/api/mcp/servers \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "filesystem",
    "transport_type": "stdio",
    "transport_config": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/data"]
    },
    "auto_connect": true,
    "tags": ["files", "storage"]
  }'
```

#### Scenario 2: Remote Server

Point Long Tail at a URL. The server runs elsewhere.

```json
{
  "transport_type": "sse",
  "transport_config": {
    "url": "https://my-server.example.com/mcp"
  }
}
```

For Streamable HTTP, use `"transport_type": "streamable-http"`. Same `transport_config`.

**Dashboard:** Select **Network Service**, enter the URL, choose SSE or Streamable HTTP, walk through Discovery/Test/Review.

**API:**

```bash
curl -X POST http://localhost:3000/api/mcp/servers \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "my-remote-server",
    "transport_type": "sse",
    "transport_config": { "url": "https://my-server.example.com/mcp" },
    "tags": ["api", "external"]
  }'
```

#### Scenario 3: Build Your Own

Write a custom MCP server, then register it the same way as Scenarios 1 or 2.

**Create the server** using the MCP SDK:

```typescript
// my-server.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const server = new McpServer({ name: 'my-tools', version: '1.0.0' });

server.tool('classify_document',
  { content: z.string() },
  async ({ content }) => {
    const result = await yourClassificationLogic(content);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  },
);

export default server;
```

**Make it runnable** via stdio (simplest):

```typescript
// bin/serve.ts
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import server from './my-server';

const transport = new StdioServerTransport();
await server.connect(transport);
```

**Register it.** The transport config points at your command — same as any stdio server:

```json
{
  "transport_type": "stdio",
  "transport_config": { "command": "node", "args": ["dist/bin/serve.js"] }
}
```

For in-process servers that run inside the Long Tail process, see the [Writing Your Own MCP Server](#writing-your-own-mcp-server) section above and the architecture guide's [Registering Your Own](architecture.md#registering-your-own) section.

### Test Connection

Test connectivity without saving a registration. The dashboard wizard's Test step and the API endpoint do the same thing — send transport fields, get back a tool list or error.

**Dashboard:** Click "Test Connection" on the Test step.

**API:**

```bash
curl -X POST http://localhost:3000/api/mcp/servers/test-connection \
  -H 'Content-Type: application/json' \
  -d '{
    "transport_type": "stdio",
    "transport_config": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    }
  }'
```

Returns `{ "success": true, "tools": [...] }` on success, or `{ "success": false, "error": "..." }` on failure.

### Edit a Registration

**Dashboard:** Click any server row in **MCP > Servers** to open the detail page. All fields are editable. Built-in servers show read-only transport config but allow editing tags, hints, and credential providers.

**API:** `PUT /api/mcp/servers/:id` with any fields to update:

```bash
curl -X PUT http://localhost:3000/api/mcp/servers/$ID \
  -H 'Content-Type: application/json' \
  -d '{
    "tags": ["database", "analytics"],
    "compile_hints": "Returns paginated results. Always pass limit.",
    "credential_providers": ["postgres"]
  }'
```

### Use in a Workflow

Once registered, a server's tools are available as durable activities:

```typescript
import { Durable } from '@hotmeshio/hotmesh';
import { McpClient } from '@hotmeshio/long-tail';

// Get tool functions from a connected MCP server
const tools = await McpClient.toolActivities(serverId);

// Proxy them as durable activities — checkpointed, retried, audited
const { mcp_doc_analyzer_classify } = Durable.workflow.proxyActivities<typeof tools>({
  activities: tools,
  retryPolicy: { maximumAttempts: 3 },
});

export async function classifyDocument(envelope: LTEnvelope) {
  const result = await mcp_doc_analyzer_classify({
    content: envelope.data.content,
  });

  if (result.confidence >= 0.85) {
    return { type: 'return', data: result };
  }

  return {
    type: 'escalation',
    data: result,
    message: 'Low confidence classification',
    role: 'reviewer',
  };
}
```

Tool names are derived from the server name and tool name: `mcp_{serverName}_{toolName}`, with non-alphanumeric characters replaced by underscores.

If the process crashes between an MCP tool call and its checkpoint, HotMesh replays from cache. The external server is not called a second time. This gives you exactly-once semantics over a protocol that doesn't natively guarantee them.

## Built-in Servers

Long Tail ships with built-in MCP servers. For descriptions, see the [architecture guide](architecture.md#built-in-mcp-servers).

| Server | Tags |
|--------|------|
| `long-tail-db-query` | database, query, analytics |
| `long-tail-human-queue` | escalation, human-queue, routing |
| `mcp-workflows-longtail` | workflows, compiled, deterministic |
| `long-tail-workflow-compiler` | compilation, yaml, codegen |
| `long-tail-translation` | translation, language, text-processing |
| `long-tail-vision` | vision, image-analysis, multimodal |
| `long-tail-playwright` | browser-automation, testing, screenshots |
| `long-tail-playwright-cli` | browser-automation, screenshots, scraping, forms |
| `long-tail-docs` | documentation, help, reference |
| `long-tail-file-storage` | storage, files, io |
| `long-tail-http-fetch` | http, api, fetch, network |
| `long-tail-oauth` | authentication, oauth, credentials |
| `long-tail-claude-code` | development, coding, ai-agent, terminal, code-generation |

## Configuration

Pass `mcp` in the `start()` config:

```typescript
import { start } from '@hotmeshio/long-tail';

const { client, shutdown } = await start({
  database: {
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'postgres',
    database: 'longtail',
  },

  mcp: {
    // Built-in Human Queue MCP server
    server: {
      enabled: true,                    // default: true
      name: 'long-tail-human-queue',    // reported to MCP clients
    },

    // External MCP server IDs to connect on startup
    autoConnect: ['server-uuid-1', 'server-uuid-2'],

    // Or replace the built-in adapter entirely:
    // adapter: new MyCustomMcpAdapter(),
  },
});
```

When `mcp.server.enabled` is `true` (the default), the Human Queue server starts and registers its tools. When `autoConnect` lists server IDs, the adapter looks them up in `lt_mcp_servers` and connects via their configured transport.

## REST API

All routes are mounted at `/api/mcp`.

### Server Registration

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/mcp/servers` | List registered servers |
| `POST` | `/api/mcp/servers` | Register a new server |
| `GET` | `/api/mcp/servers/:id` | Get a server by ID |
| `PUT` | `/api/mcp/servers/:id` | Update a server |
| `DELETE` | `/api/mcp/servers/:id` | Delete a server |

**Query parameters** for `GET /api/mcp/servers`:

- `status` — filter by status (`registered`, `connected`, `error`, `disconnected`)
- `auto_connect` — filter by auto-connect (`true`, `false`)
- `limit`, `offset` — pagination

### Connection Management

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/mcp/servers/test-connection` | Test connectivity without saving |
| `POST` | `/api/mcp/servers/:id/connect` | Connect to a server |
| `POST` | `/api/mcp/servers/:id/disconnect` | Disconnect from a server |

### Tool Operations

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/mcp/servers/:id/tools` | List tools on a connected server |
| `POST` | `/api/mcp/servers/:id/tools/:toolName/call` | Call a tool |

**Call a tool:**

```bash
curl -X POST http://localhost:3000/api/mcp/servers/$ID/tools/search/call \
  -H 'Content-Type: application/json' \
  -d '{ "arguments": { "query": "hello" } }'
```

Server registrations are persisted in PostgreSQL so they survive restarts.

## Database Schema

MCP server registrations are stored in `lt_mcp_servers`:

```sql
CREATE TABLE IF NOT EXISTS lt_mcp_servers (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT UNIQUE NOT NULL,
  description          TEXT,
  transport_type       TEXT NOT NULL CHECK (transport_type IN ('stdio', 'sse', 'streamable-http')),
  transport_config     JSONB NOT NULL DEFAULT '{}'::JSONB,
  auto_connect         BOOLEAN NOT NULL DEFAULT false,
  tool_manifest        JSONB,            -- cached from last listTools()
  tags                 TEXT[],           -- categorization for tag-based tool discovery
  compile_hints        TEXT,             -- per-server instructions for the compilation pipeline
  credential_providers TEXT[] DEFAULT '{}', -- IAM providers required by tools
  status               TEXT NOT NULL DEFAULT 'registered'
                         CHECK (status IN ('registered', 'connected', 'error', 'disconnected')),
  last_connected_at    TIMESTAMPTZ,
  metadata             JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

The `tool_manifest` column caches the result of `listTools()` on each successful connection, so tools can be enumerated without a live connection.

The `tags` column is a PostgreSQL text array with a GIN index, enabling fast tag-based tool discovery via `findServersByTags(tags, 'any'|'all')`. Workflows like `mcpQuery` discover all tools or filter by user-provided tags.

The `compile_hints` column stores per-server instructions that are injected into the compilation prompt when that server's tools appear in an execution trace. This lets each server provide tool-specific constraints (e.g., timeout requirements, retry policies, ordering rules) that guide the compiler when converting dynamic executions into deterministic workflows.

The `credential_providers` column lists IAM credential providers required by the server's tools. When a user invokes a tool, the system checks whether they have registered credentials for each listed provider. Missing credentials trigger a `MissingCredentialError` with the provider name, prompting the user to connect via the Credentials page.

The schema is created automatically by `migrate()`. See `services/db/schemas/001_initial.sql`.

The test suite verifies the full MCP protocol against real PostgreSQL — no mocks.

## Testing

### InMemoryTransport Pattern

The test suite uses `InMemoryTransport.createLinkedPair()` from the MCP SDK to connect a real client to the real server through linked in-process transports, hitting real PostgreSQL. No mocks.

```typescript
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createHumanQueueServer, stopServer } from '../../services/mcp/server';

// Reset singleton, create fresh server
await stopServer();
const server = await createHumanQueueServer({ name: 'test-human-queue' });

// Linked in-memory transports
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);

const client = new McpClient({ name: 'test-client', version: '1.0.0' });
await client.connect(clientTransport);

// Now use client.callTool(), client.listTools(), etc.
```

The shared test utility at `tests/setup/mcp.ts` wraps this pattern as `createMcpTestClient()` and provides:

- `parseMcpResult(result)` — extracts and JSON-parses `result.content[0].text`
- `waitForEscalationViaMcp(client, role, timeout, interval)` — polls `get_available_work` until escalations appear

### Running MCP Tests

```bash
# Human Queue protocol tests (8 tests — real client, real server, real DB)
npm run test:mcp

# Vision MCP server tool tests
npm run test:mcp:vision

# Full integration with OpenAI Vision
OPENAI_API_KEY=sk-... npm run test:mcp:vision

# All tests
npm test
```

### What the Protocol Tests Prove

The `tests/mcp.test.ts` suite includes 8 tests:

1. **Tool discovery** — `listTools()` returns the expected tools
2. **Create** — `escalate_to_human` writes a real PostgreSQL record
3. **Check** — `check_resolution` reads status from DB
4. **List** — `get_available_work` filters by role
5. **Resolve** — `claim_and_resolve` atomically claims and resolves
6. **Full lifecycle** — escalate -> check -> list -> resolve -> check -> list (empty)
7. **Error: not found** — checking a nonexistent ID returns `isError: true`
8. **Error: already resolved** — claiming a resolved escalation returns `isError: true`

The `tests/workflows/verify-document-mcp.test.ts` suite adds:

1. **Vision tool discovery** — `listTools()` returns 3 Vision tools
2. **list_document_pages** — returns page refs from storage
3. **validate_member** — match, mismatch, and not_found cases
4. **extract_member_info** — extracts via OpenAI Vision (needs API key)
5. **Full MCP-native workflow** — extraction -> validation -> escalation -> Human Queue MCP resolution

Every test verifies both the MCP response and the actual database state.

## Custom Adapters

The `LTMcpAdapter` interface lets you replace the built-in adapter entirely:

```typescript
interface LTMcpAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  connectClient(serverId: string): Promise<void>;
  disconnectClient(serverId: string): Promise<void>;
  listTools(serverId: string): Promise<LTMcpToolManifest[]>;
  callTool(serverId: string, toolName: string, args: Record<string, any>): Promise<any>;
  toolActivities(serverId: string): Promise<Record<string, (...args: any[]) => Promise<any>>>;
}
```

Pass your implementation in the startup config:

```typescript
await start({
  database: { /* ... */ },
  mcp: {
    adapter: new MyCustomMcpAdapter(),
  },
});
```

The adapter registry follows the same pattern as auth, telemetry, events, and logging — a single-adapter registry with `connect()`/`disconnect()` lifecycle hooks.
