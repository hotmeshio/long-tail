-- Allow 'streamable-http' as a transport type for MCP servers
ALTER TABLE lt_mcp_servers
  DROP CONSTRAINT IF EXISTS lt_mcp_servers_transport_type_check;

ALTER TABLE lt_mcp_servers
  ADD CONSTRAINT lt_mcp_servers_transport_type_check
  CHECK (transport_type IN ('stdio', 'sse', 'streamable-http'));
