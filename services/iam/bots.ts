/**
 * Bot account management.
 *
 * Bot accounts are rows in lt_users with account_type = 'bot'.
 * They share the same RBAC, OAuth credentials, and delegation tokens
 * as human users — no separate infrastructure needed.
 */
import { getPool } from '../db';
import { createUser, getUser, updateUser, deleteUser } from '../user';
import { addUserRole, removeUserRole, getUserRoles } from '../user';
import type { LTUserRecord, LTRoleType } from '../../types';
import type { CreateUserInput } from '../user';
import { generateBotApiKey, listBotApiKeys, revokeBotApiKey } from '../auth/bot-api-key';
import type { BotApiKeyRecord } from '../auth/bot-api-key';

export type { BotApiKeyRecord };

export interface CreateBotInput {
  /** Unique identifier (used as external_id). */
  name: string;
  /** Human-readable description of the bot's purpose. */
  description?: string;
  /** Display name shown in audit logs. */
  display_name?: string;
  /** Initial roles to assign. */
  roles?: Array<{ role: string; type: LTRoleType }>;
  /** ID of the user creating this bot (for audit). */
  created_by?: string;
}

export interface BotAccountRecord extends LTUserRecord {
  /** Always 'bot' for bot accounts. */
  account_type: 'bot';
  /** Description from metadata. */
  description?: string;
  /** Who created this bot. */
  created_by?: string;
}

const LIST_BOTS = `
  SELECT * FROM lt_users
  WHERE account_type = 'bot'
  ORDER BY created_at DESC
  LIMIT $1 OFFSET $2`;

const COUNT_BOTS = `
  SELECT COUNT(*)::int AS total FROM lt_users WHERE account_type = 'bot'`;

/**
 * Create a new bot account.
 */
export async function createBot(input: CreateBotInput): Promise<BotAccountRecord> {
  const userInput: CreateUserInput = {
    external_id: input.name,
    display_name: input.display_name ?? input.name,
    roles: input.roles,
    metadata: {
      account_type: 'bot',
      description: input.description,
      created_by: input.created_by,
    },
  };

  // Create the user row, then set account_type column
  const user = await createUser(userInput);
  const pool = await getPool();
  await pool.query(
    'UPDATE lt_users SET account_type = $1 WHERE id = $2',
    ['bot', user.id],
  );

  return toBotRecord(user, input.description, input.created_by);
}

/**
 * Get a single bot account by ID.
 */
export async function getBot(id: string): Promise<BotAccountRecord | null> {
  const user = await getUser(id);
  if (!user || (user.metadata as any)?.account_type !== 'bot') return null;
  return toBotRecord(user);
}

/**
 * List all bot accounts with pagination.
 */
export async function listBots(
  limit: number = 50,
  offset: number = 0,
): Promise<{ bots: BotAccountRecord[]; total: number }> {
  const pool = await getPool();
  const [{ rows }, countResult] = await Promise.all([
    pool.query(LIST_BOTS, [limit, offset]),
    pool.query(COUNT_BOTS),
  ]);

  // Attach roles to each bot
  const bots = await Promise.all(
    rows.map(async (row: any) => {
      const roles = await getUserRoles(row.id);
      return toBotRecord({ ...row, roles });
    }),
  );

  return { bots, total: countResult.rows[0].total };
}

/**
 * Update a bot account.
 */
export async function updateBot(
  id: string,
  input: { display_name?: string; description?: string; status?: string },
): Promise<BotAccountRecord | null> {
  const existing = await getBot(id);
  if (!existing) return null;

  const metadata = {
    ...(existing.metadata || {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
  };

  const user = await updateUser(id, {
    display_name: input.display_name,
    status: input.status as any,
    metadata,
  });
  if (!user) return null;
  return toBotRecord(user);
}

/**
 * Deactivate a bot account (sets status to 'inactive').
 */
export async function deactivateBot(id: string): Promise<boolean> {
  const bot = await getBot(id);
  if (!bot) return false;
  const updated = await updateUser(id, { status: 'inactive' });
  return !!updated;
}

/**
 * Delete a bot account and all its API keys (cascaded).
 */
export async function deleteBot(id: string): Promise<boolean> {
  const bot = await getBot(id);
  if (!bot) return false;
  return deleteUser(id);
}

// ── Bot API key management ─────────────────────────────────────────────────

/**
 * Generate a new API key for a bot.
 */
export async function createBotKey(
  botId: string,
  name: string,
  scopes: string[] = [],
  expiresAt?: Date,
): Promise<{ id: string; rawKey: string }> {
  const bot = await getBot(botId);
  if (!bot) throw new Error('Bot not found');
  return generateBotApiKey(name, botId, scopes, expiresAt);
}

/**
 * List API keys for a bot (without hashes).
 */
export { listBotApiKeys as listBotKeys };

/**
 * Revoke a bot API key.
 */
export { revokeBotApiKey as revokeBotKey };

// ── Bot role management (delegates to user role service) ───────────────────

export { addUserRole as addBotRole };
export { removeUserRole as removeBotRole };
export { getUserRoles as getBotRoles };

// ── System bot ─────────────────────────────────────────────────────────────

const SYSTEM_BOT_NAME = 'lt-system';

/**
 * Ensure the system bot account exists.
 * Called at startup so cron and system-initiated workflows
 * always have a principal (the `lt-system` bot).
 */
export async function ensureSystemBot(): Promise<string> {
  const pool = await getPool();
  const { rows } = await pool.query(
    'SELECT id FROM lt_users WHERE external_id = $1',
    [SYSTEM_BOT_NAME],
  );
  if (rows.length > 0) return rows[0].id;

  const bot = await createBot({
    name: SYSTEM_BOT_NAME,
    display_name: 'System',
    description: 'System bot for cron and system-initiated workflows',
    roles: [{ role: 'system', type: 'admin' }],
  });
  return bot.id;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function toBotRecord(
  user: LTUserRecord,
  description?: string,
  createdBy?: string,
): BotAccountRecord {
  return {
    ...user,
    account_type: 'bot',
    description: description ?? (user.metadata as any)?.description,
    created_by: createdBy ?? (user.metadata as any)?.created_by,
  };
}
