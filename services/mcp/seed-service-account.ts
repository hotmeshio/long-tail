/**
 * Seed the MCP service account at startup.
 *
 * Creates a single `mcp-service` bot account with two API keys:
 *   - `mcp:read`  — read-safe tools only (discovery, monitoring)
 *   - `mcp:full`  — all tools (automation, orchestration)
 *
 * Idempotent — skips creation if the account already exists.
 * Keys are generated once and logged; they cannot be retrieved again.
 */

import { loggerRegistry } from '../../lib/logger';
import { getUserByExternalId } from '../user/crud';
import * as iam from '../iam';

const SERVICE_ACCOUNT_NAME = 'mcp-service';

export async function seedMcpServiceAccount(): Promise<void> {
  try {
    // Check if account already exists (bot external_id = name)
    const existing = await getUserByExternalId(SERVICE_ACCOUNT_NAME);
    if (existing) {
      loggerRegistry.info(`[seed-mcp] ${SERVICE_ACCOUNT_NAME} already exists, skipping`);
      return;
    }

    // Create the service account
    const bot = await iam.createBot({
      name: SERVICE_ACCOUNT_NAME,
      description: 'MCP service account for external tool access. Use the read key to explore, full key to automate.',
      display_name: 'MCP Service',
      roles: [{ role: 'system', type: 'member' }],
    });

    // Generate read key (scoped to mcp:read)
    const readKey = await iam.createBotKey(bot.id, 'read', ['mcp:read']);
    loggerRegistry.info(`[seed-mcp] read key: ${readKey.rawKey}`);

    // Generate full key (scoped to mcp:full)
    const fullKey = await iam.createBotKey(bot.id, 'full', ['mcp:read', 'mcp:full']);
    loggerRegistry.info(`[seed-mcp] full key: ${fullKey.rawKey}`);

    loggerRegistry.info(`[seed-mcp] ${SERVICE_ACCOUNT_NAME} created with read + full API keys`);
  } catch (err: any) {
    loggerRegistry.warn(`[seed-mcp] failed to seed: ${err.message}`);
  }
}
