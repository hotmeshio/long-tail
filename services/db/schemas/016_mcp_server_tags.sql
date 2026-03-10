-- Add tags column to lt_mcp_servers for efficient tool filtering by category
ALTER TABLE lt_mcp_servers
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

-- GIN index for array containment queries (@> and &&)
CREATE INDEX IF NOT EXISTS idx_lt_mcp_servers_tags
  ON lt_mcp_servers USING GIN (tags);

-- Backfill tags from metadata.category for existing servers
UPDATE lt_mcp_servers
SET tags = ARRAY[metadata->>'category']
WHERE metadata->>'category' IS NOT NULL
  AND tags = '{}';
