# MCP Integration

Long Tail integrates with the [Model Context Protocol](https://modelcontextprotocol.io/) in two directions. Outbound: it connects to external MCP servers and wraps their tools as durable, checkpointed activities. Inbound: it exposes its own escalation queue as an MCP server that any agent can call. Both directions share a single adapter interface and are managed through the same startup configuration.

## Contents

- [Architecture](#architecture)
- [Configuration](#configuration)
- [Human Queue Server](#human-queue-server) — the 4 built-in tools
- [MCP Client Connections](#mcp-client-connections) — external tools as durable activities
- [Verify Document Example](#verify-document-example) — OpenAI Vision + escalation, end to end
- [MCP-Native Verify Document](#mcp-native-verify-document) — same pipeline, MCP tools underneath
- [REST API](#rest-api) — server registration and management
- [Database Schema](#database-schema)
- [Testing](#testing) — InMemoryTransport and functional tests
- [Custom Adapters](#custom-adapters)

## Architecture

```
┌───────────────────────────────────────────────────────────┐
│  Long Tail                                                │
│                                                           │
│   ┌───────────────┐      ┌─────────────────────────────┐  │
│   │  MCP Adapter  │─────▶│  Human Queue MCP Server     │  │
│   │  (registry)   │      │  4 tools → escalation DB    │  │
│   │               │      └─────────────────────────────┘  │
│   │               │                                       │
│   │               │      ┌─────────────────────────────┐  │
│   │               │─────▶│  MCP Client (outbound)      │  │
│   │               │      │  stdio | sse → external     │  │
│   └───────────────┘      └─────────────────────────────┘  │
│                                                           │
│   ┌──────────────┐      ┌─────────────────────────────┐   │
│   │  Workflows   │─────▶│  proxyActivities()          │   │
│   │              │      │  MCP tool → durable actvty  │   │
│   └──────────────┘      └─────────────────────────────┘   │
└───────────────────────────────────────────────────────────┘
         ▲                          ▲
         │                          │
    AI agents,                External MCP
    human SPAs               servers (stdio/sse)
```

The **MCP Adapter** is a singleton registered via `start()`. It manages the Human Queue server (inbound) and any number of outbound client connections. The built-in adapter (`BuiltInMcpAdapter`) handles both; you can replace it with a custom implementation.

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

When `mcp.server.enabled` is `true` (the default), the Human Queue server starts and registers its 4 tools. When `autoConnect` lists server IDs, the adapter looks them up in `lt_mcp_servers` and connects via their configured transport.

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

### Connecting to the Human Queue

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

## MCP Client Connections

Long Tail can connect to external MCP servers and invoke their tools as durable activities. Register servers in the database, then wrap their tools with `proxyActivities()` — the same mechanism used for any workflow activity.

### Register a Server

```bash
curl -X POST http://localhost:3000/api/mcp/servers \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "doc-analyzer",
    "transport_type": "stdio",
    "transport_config": {
      "command": "npx",
      "args": ["-y", "doc-analyzer-mcp"]
    },
    "auto_connect": true
  }'
```

Or via SSE:

```bash
curl -X POST http://localhost:3000/api/mcp/servers \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "my-remote-server",
    "transport_type": "sse",
    "transport_config": {
      "url": "https://my-server.example.com/mcp"
    },
    "auto_connect": false
  }'
```

### Use in a Workflow

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

## Verify Document Example

The `verify-document` workflow demonstrates the full pattern: AI does initial work (OpenAI Vision extraction), validates against a database, and escalates to a human when it isn't confident. MCP tools let agents query and resolve the escalation queue.

### The Workflow

```
Document images → Vision extraction → Database validation → Match or escalate
```

**Step 1 — List pages.** The workflow loads document page images from storage.

**Step 2 — Extract.** Each page is sent to OpenAI's Vision API (`gpt-4o-mini`) as a durable activity. The prompt asks for structured JSON: member ID, name, address, phone, email, emergency contact.

**Step 3 — Merge.** Multi-page extractions are merged. The primary page (with member ID) provides the base record; partial pages (emergency contact, additional fields) are folded in.

**Step 4 — Validate.** The merged record is compared against the member database. Address fields are checked for exact match. Member status must be `active`.

**Step 5 — Return or escalate.** If everything matches, the workflow returns. If there's a mismatch or missing data, it escalates with full context:

```typescript
return {
  type: 'escalation',
  data: {
    documentId,
    extractedInfo: merged,        // what Vision saw
    validationResult: 'mismatch', // why it's escalating
    databaseRecord: record,       // what the database has
    reason: 'Address mismatch for MBR-2024-001...',
  },
  message: reason,
  role: 'reviewer',
};
```

### Durable Activities

Each activity (list pages, extract, validate) is wrapped with `proxyActivities()`:

```typescript
const { listDocumentPages, extractMemberInfo, validateMember } =
  Durable.workflow.proxyActivities<ActivitiesType>({
    activities,
    retryPolicy: {
      maximumAttempts: 2,
      backoffCoefficient: 2,
      maximumInterval: '10 seconds',
    },
  });
```

If the process crashes after `extractMemberInfo` completes but before `validateMember` starts, the workflow replays from the last checkpoint. The Vision API is not called again.

### The Interceptor

When the workflow returns `{ type: 'escalation' }`, Long Tail's interceptor:

1. Creates an escalation record in PostgreSQL with the full payload
2. Pauses — the workflow is done, but the escalation lives on
3. When a resolver provides data, the interceptor starts a **new workflow execution** with `envelope.resolver` populated
4. The workflow checks `if (envelope.resolver)` and returns immediately with the human-provided data

This is the re-run pattern: escalation → human review → new execution → resolved.

### MCP in the Tests

The test suite uses MCP tools to verify the escalation lifecycle alongside the workflow:

```typescript
// After the workflow escalates:
const checkPending = await mcpClient.callTool({
  name: 'check_resolution',
  arguments: { escalation_id: esc.id },
});
expect(parseMcpResult(checkPending).status).toBe('pending');

// Verify escalation appears in the reviewer queue:
const work = await mcpClient.callTool({
  name: 'get_available_work',
  arguments: { role: 'reviewer', limit: 100 },
});
expect(
  parseMcpResult(work).escalations.some(
    (e) => e.escalation_id === esc.id,
  ),
).toBe(true);

// After human resolves via re-run workflow:
const checkResolved = await mcpClient.callTool({
  name: 'check_resolution',
  arguments: { escalation_id: esc.id },
});
expect(parseMcpResult(checkResolved).status).toBe('resolved');
```

The tests use `InMemoryTransport` — a real MCP client talks to the real Human Queue server through linked in-process transports, hitting real PostgreSQL. No mocks.

## MCP-Native Verify Document

The example above calls OpenAI Vision directly via `proxyActivities()`. The `verify-document-mcp` workflow takes this a step further: every activity call — listing pages, extracting data, validating members — routes through a **Document Vision MCP server**. Both sides of the pipeline speak MCP: Vision tools for AI work, Human Queue tools for escalation.

### Document Vision MCP Server

The Vision server (`services/mcp/vision-server.ts`) wraps the three verify-document activities as MCP tools:

| Tool | Arguments | Returns |
|------|-----------|---------|
| `list_document_pages` | *(none)* | `{ pages: string[] }` |
| `extract_member_info` | `{ image_ref, page_number }` | `{ member_info: MemberInfo \| null }` |
| `validate_member` | `{ member_info: MemberInfo }` | `{ result, databaseRecord? }` |

It follows the same singleton pattern as the Human Queue server — Zod schemas at module level, `createVisionServer()` / `stopVisionServer()` lifecycle.

### Activity Wrappers

The MCP-native workflow doesn't call activities directly. Instead, `workflows/verify-document-mcp/activities.ts` provides thin wrappers with the same function signatures as the originals. Each one connects to the Vision server via `InMemoryTransport` and calls the corresponding MCP tool:

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

### The Composition

```
verify-document-mcp workflow
  │
  ├─ proxyActivities → MCP client ── InMemoryTransport ──▶ Vision MCP Server
  │                                                         ├ list_document_pages
  │                                                         ├ extract_member_info (→ OpenAI Vision)
  │                                                         └ validate_member (→ member DB)
  │
  └─ return { type: 'escalation' }
       │
       └─ interceptor → Human Queue MCP Server
                          ├ check_resolution
                          ├ get_available_work
                          └ claim_and_resolve
```

AI tools and human tools, same protocol, same durability guarantees.

### Running the MCP-Native Tests

```bash
# Vision server tool tests (no OpenAI key needed for most)
npm run test:mcp:vision

# With verbose output
npx vitest run tests/workflows/verify-document-mcp.test.ts --reporter=verbose

# Full integration (needs OpenAI key for extraction + workflow tests)
OPENAI_API_KEY=sk-... npm run test:mcp:vision
```

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

## Database Schema

MCP server registrations are stored in `lt_mcp_servers`:

```sql
CREATE TABLE IF NOT EXISTS lt_mcp_servers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT UNIQUE NOT NULL,
  description       TEXT,
  transport_type    TEXT NOT NULL CHECK (transport_type IN ('stdio', 'sse')),
  transport_config  JSONB NOT NULL DEFAULT '{}'::JSONB,
  auto_connect      BOOLEAN NOT NULL DEFAULT false,
  tool_manifest     JSONB,         -- cached from last listTools()
  status            TEXT NOT NULL DEFAULT 'registered'
                      CHECK (status IN ('registered', 'connected', 'error', 'disconnected')),
  last_connected_at TIMESTAMPTZ,
  metadata          JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

The `tool_manifest` column caches the result of `listTools()` on each successful connection, so tools can be enumerated without a live connection.

The schema is created automatically by `migrate()`. See `services/db/schemas/004_mcp_servers.sql`.

## Testing

### Running MCP Tests

```bash
# MCP protocol tests (functional — real client, real server, real DB)
npm run test:mcp

# Vision workflow tests with MCP assertions (requires OpenAI key)
OPENAI_API_KEY=sk-... npx vitest run tests/workflows/verify-document.test.ts

# Full suite
npm test
```

For verbose output, pass `--reporter=verbose`:

```bash
npx vitest run tests/mcp.test.ts --reporter=verbose
```

### InMemoryTransport Pattern

The test suite uses `InMemoryTransport.createLinkedPair()` from the MCP SDK to connect a real client to the real server without network I/O:

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

### What the Functional Tests Prove

The `tests/mcp.test.ts` suite includes 8 protocol-level tests:

1. **Tool discovery** — `listTools()` returns exactly 4 tools
2. **Create** — `escalate_to_human` writes a real PostgreSQL record
3. **Check** — `check_resolution` reads status from DB
4. **List** — `get_available_work` filters by role
5. **Resolve** — `claim_and_resolve` atomically claims and resolves
6. **Full lifecycle** — escalate → check → list → resolve → check → list (empty)
7. **Error: not found** — checking a nonexistent ID returns `isError: true`
8. **Error: already resolved** — claiming a resolved escalation returns `isError: true`

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
