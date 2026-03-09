-- Rename the built-in MCP workflow server to follow the mcp-workflows-{namespace} convention.
UPDATE lt_mcp_servers
SET name = 'mcp-workflows-longtail', updated_at = NOW()
WHERE name = 'long-tail-mcp-workflows';
