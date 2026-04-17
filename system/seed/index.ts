import { getPool } from '../../lib/db';
import { loggerRegistry } from '../../lib/logger';
import { SEED_MCP_SERVER, DELETE_STALE_BUILTIN_SERVERS } from '../../services/mcp/sql';

import { SEED_MCP_SERVERS } from './server-definitions';

export { SEED_MCP_SERVERS };

/**
 * Seed system MCP servers into lt_mcp_servers.
 * Upserts each built-in server with its tool manifest, metadata, and tags.
 */
export async function seedSystemMcpServers(): Promise<void> {
  const pool = getPool();
  for (const srv of SEED_MCP_SERVERS) {
    try {
      await pool.query(
        SEED_MCP_SERVER,
        [
          srv.name,
          srv.description,
          srv.transport_type,
          JSON.stringify(srv.transport_config),
          JSON.stringify(srv.tool_manifest),
          JSON.stringify(srv.metadata),
          srv.tags,
          srv.compile_hints,
          srv.credential_providers || [],
        ],
      );
    } catch (err: any) {
      loggerRegistry.warn(`[system] failed to seed MCP server ${srv.name}: ${err.message}`);
    }
  }
  // Remove stale builtin servers no longer in the seed list
  const seedNames = SEED_MCP_SERVERS.map(s => s.name);
  try {
    const { rows } = await pool.query(DELETE_STALE_BUILTIN_SERVERS, [seedNames]);
    for (const row of rows) {
      loggerRegistry.info(`[system] removed stale builtin MCP server: ${row.name}`);
    }
  } catch (err: any) {
    loggerRegistry.warn(`[system] failed to clean stale MCP servers: ${err.message}`);
  }

  const totalTools = SEED_MCP_SERVERS.reduce((sum, s) => sum + s.tool_manifest.length, 0);
  loggerRegistry.info(`[system] MCP servers seeded (${SEED_MCP_SERVERS.length} servers, ${totalTools} tools)`);
}
