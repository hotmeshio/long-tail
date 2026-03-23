MCP (Model Context Protocol) integration layer — manages server registration, client connections, tool discovery, and the human-queue escalation server.

Key files:
- `index.ts` — `LTMcpRegistry` singleton: `register(adapter)`, `connect()`, `disconnect()`, `clear()`
- `adapter.ts` — `BuiltInMcpAdapter`: manages one MCP server (human queue) and multiple client connections to external/built-in servers
- `client.ts` — MCP client connection manager. Connects to external servers via stdio/SSE and to built-in servers via `InMemoryTransport`. Caches active clients by server ID/name.
- `server.ts` — Human Queue MCP server exposing escalation tools (`escalate`, `list-escalations`, `resolve-escalation`)
- `db.ts` — CRUD for `lt_mcp_servers` table: create, get, update, delete, list, tag-based discovery (`findServersByTags`)
- `sql.ts` — Static SQL constants for server CRUD
- `db-server.ts` — Built-in MCP server for database queries
- `vision-server.ts` — Built-in MCP server for document vision (OCR, translation)
- `workflow-server.ts` — Built-in MCP server for workflow operations
- `workflow-compiler-server.ts` — Built-in MCP server for YAML workflow compilation
- `playwright-server.ts` — Built-in MCP server for browser automation (referenced from system/)

Inline SQL to externalize:
- `db.ts` lines 97, 161-163, 193 — dynamic UPDATE, list pagination, and tag-based SELECT queries are inline. The static queries are already in `sql.ts`, but the dynamic ones remain inline due to runtime SQL construction.
