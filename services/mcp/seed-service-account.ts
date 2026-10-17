/**
 * Seed the MCP service account at startup.
 *
 * Creates a single `mcp-service` bot account with two API keys:
 *   - `mcp:read`  — read-safe tools only (discovery, monitoring)
 *   - `mcp:full`  — all tools (automation, orchestration)
 *
 * Idempotent — skips creation if the account already exists.
 * With LT_SEED_SERVICE_KEYS=true (local docker compose) the keys are
 * generated once and printed to stdout, never to the logger; they cannot be
 * retrieved again. Otherwise the account is created without keys and a
 * superadmin mints them from the dashboard or the bot-accounts API.
 */

import { loggerRegistry } from '../../lib/logger';
import { config } from '../../modules/config';
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

    if (!config.LT_SEED_SERVICE_KEYS) {
      loggerRegistry.info(`[seed-mcp] ${SERVICE_ACCOUNT_NAME} created; mint its API keys from the dashboard`);
      return;
    }

    const readKey = await iam.createBotKey(bot.id, 'read', ['mcp:read']);
    const fullKey = await iam.createBotKey(bot.id, 'full', ['mcp:read', 'mcp:full']);
    process.stdout.write(`[seed-mcp] read key: ${readKey.rawKey}\n[seed-mcp] full key: ${fullKey.rawKey}\n`);
    loggerRegistry.info(`[seed-mcp] ${SERVICE_ACCOUNT_NAME} created with read + full API keys (printed to stdout)`);
  } catch (err: any) {
    loggerRegistry.warn(`[seed-mcp] failed to seed: ${err.message}`);
  }
}
