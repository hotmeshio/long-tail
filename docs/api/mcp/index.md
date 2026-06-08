# MCP Tools Reference

Long Tail exposes its full API surface as MCP (Model Context Protocol) tools. These tools allow AI agents (or Long Tail itself in reflexive mode) to perform any action a human would via the dashboard or REST APIs.

## Exposure Control

Configure which tools are exposed when Long Tail acts as an MCP server:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `mcp.exposure.readOnly` | boolean | false | Only expose tools marked `read_safe` |
| `mcp.exposure.hideAiWhenUnavailable` | boolean | true | Hide AI-dependent servers when no API key |
| `mcp.exposure.allowServers` | string[] | — | Explicit server allowlist |
| `mcp.exposure.denyServers` | string[] | — | Server denylist |

## Built-in Servers

These servers ship with the product and reflect the core API surface:

| Server | Category | Tools | Description |
|--------|----------|-------|-------------|
| [long-tail-admin](admin.md) | System | 71 | Unified system management — tasks, escalations, agents, workflows, users, etc. |
| [long-tail-human-queue](human-queue.md) | Automation | 5 | Escalation workflow primitives (durable pause + signal) |
| [long-tail-file-storage](file-storage.md) | Data | 4 | Managed file storage (MinIO/GCS/S3) |
| [long-tail-http-fetch](http-fetch.md) | Data | 3 | HTTP client for external requests |
| [long-tail-schema-exchange](schema-exchange.md) | Data | 2 | Schema-validated HTTP exchange with credential resolution |
| [long-tail-oauth](oauth.md) | System | 3 | OAuth token management and refresh |
| [long-tail-knowledge](knowledge.md) | Data | 7 | Persistent JSONB knowledge store |
| [long-tail-docs](docs.md) | Reference | 3 | Documentation search and retrieval |
| [long-tail-events](events.md) | Communication | 4 | Event bus pub/sub |
| [long-tail-vision](vision.md) | Analysis | 2 | Image analysis via LLM vision (AI key required) |
| [long-tail-translation](translation.md) | Analysis | 1 | Text translation via LLM (AI key required) |
| [long-tail-claude-code](claude-code.md) | Development | 2 | Agentic code execution (AI key required) |

## Example Servers

These servers are included as examples of how to extend Long Tail with additional MCP capabilities. They demonstrate the registration pattern for adding browser automation or other domain-specific tools:

| Server | Category | Description |
|--------|----------|-------------|
| long-tail-playwright | Automation | Low-level browser automation via Playwright (requires binary) |
| long-tail-playwright-cli | Automation | High-level browser automation |
| long-tail-gmail | Communication | Gmail integration (OAuth) |
| long-tail-image-tools | Media | Image processing via sharp |

See `examples/mcp-servers/` for the registration pattern.

## Read-Safe Classification

Every tool is classified as either **read-safe** (query-only, no side effects) or **write** (modifies state). When `mcp.exposure.readOnly` is enabled, only read-safe tools are available to external MCP consumers.
