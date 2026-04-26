import * as iam from '../services/iam';
import { isValidRoleType } from '../services/user';
import type { LTApiResult, LTApiAuth } from '../types/sdk';

/**
 * List all bot accounts with pagination.
 *
 * @param input.limit — maximum number of bots to return (default 50)
 * @param input.offset — number of bots to skip for pagination (default 0)
 * @returns `{ status: 200, data: Bot[] }` paginated list of bots
 */
export async function listBots(input: {
  limit?: number;
  offset?: number;
}): Promise<LTApiResult> {
  try {
    const limit = input.limit ?? 50;
    const offset = input.offset ?? 0;
    const result = await iam.listBots(limit, offset);
    return { status: 200, data: result };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Retrieve a single bot account by ID.
 *
 * @param input.id — unique identifier of the bot
 * @returns `{ status: 200, data: Bot }` the bot record, or 404 if not found
 */
export async function getBot(input: {
  id: string;
}): Promise<LTApiResult> {
  try {
    const bot = await iam.getBot(input.id);
    if (!bot) {
      return { status: 404, error: 'Bot not found' };
    }
    return { status: 200, data: bot };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Create a new bot account with optional roles.
 *
 * Validates that each provided role has a valid type (superadmin, admin, member).
 * Returns 409 if a bot with the same name already exists.
 *
 * @param input.name — unique bot name (required)
 * @param input.description — optional text description of the bot
 * @param input.display_name — optional human-friendly display name
 * @param input.roles — optional list of roles to assign at creation, each with a role name and type
 * @param auth — authenticated user context; userId is recorded as the bot creator
 * @returns `{ status: 201, data: Bot }` the newly created bot record
 */
export async function createBot(
  input: {
    name: string;
    description?: string;
    display_name?: string;
    roles?: { role: string; type: string }[];
  },
  auth?: LTApiAuth,
): Promise<LTApiResult> {
  try {
    if (!input.name) {
      return { status: 400, error: 'name is required' };
    }
    if (input.roles) {
      for (const r of input.roles) {
        if (!r.role || !r.type || !isValidRoleType(r.type)) {
          return {
            status: 400,
            error: 'Each role must have a role name and type (superadmin, admin, member)',
          };
        }
      }
    }
    const bot = await iam.createBot({
      name: input.name,
      description: input.description,
      display_name: input.display_name,
      roles: input.roles as any,
      created_by: auth?.userId,
    });
    return { status: 201, data: bot };
  } catch (err: any) {
    if (err.code === '23505') {
      return { status: 409, error: 'Bot with this name already exists' };
    }
    return { status: 500, error: err.message };
  }
}

/**
 * Update mutable fields on an existing bot account.
 *
 * @param input.id — unique identifier of the bot to update
 * @param input.display_name — new display name
 * @param input.description — new description
 * @param input.status — new status value
 * @returns `{ status: 200, data: Bot }` the updated bot record, or 404 if not found
 */
export async function updateBot(input: {
  id: string;
  display_name?: string;
  description?: string;
  status?: string;
}): Promise<LTApiResult> {
  try {
    const { id, ...fields } = input;
    const bot = await iam.updateBot(id, fields);
    if (!bot) {
      return { status: 404, error: 'Bot not found' };
    }
    return { status: 200, data: bot };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Delete a bot account by ID.
 *
 * @param input.id — unique identifier of the bot to delete
 * @returns `{ status: 200, data: { deleted: true } }` on success, or 404 if not found
 */
export async function deleteBot(input: {
  id: string;
}): Promise<LTApiResult> {
  try {
    const deleted = await iam.deleteBot(input.id);
    if (!deleted) {
      return { status: 404, error: 'Bot not found' };
    }
    return { status: 200, data: { deleted: true } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * List all roles assigned to a bot account.
 *
 * @param input.id — unique identifier of the bot
 * @returns `{ status: 200, data: { roles: Role[] } }` the bot's roles, or 404 if bot not found
 */
export async function getBotRoles(input: {
  id: string;
}): Promise<LTApiResult> {
  try {
    const bot = await iam.getBot(input.id);
    if (!bot) {
      return { status: 404, error: 'Bot not found' };
    }
    const roles = await iam.getBotRoles(input.id);
    return { status: 200, data: { roles } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Assign a role to a bot account.
 *
 * Validates that the role type is one of superadmin, admin, or member.
 *
 * @param input.id — unique identifier of the bot
 * @param input.role — role name to assign
 * @param input.type — role type (superadmin, admin, or member)
 * @returns `{ status: 201, data: Role }` the newly assigned role, or 404 if bot not found
 */
export async function addBotRole(input: {
  id: string;
  role: string;
  type: string;
}): Promise<LTApiResult> {
  try {
    if (!input.role || !input.type) {
      return { status: 400, error: 'role and type are required' };
    }
    if (!isValidRoleType(input.type)) {
      return { status: 400, error: 'type must be superadmin, admin, or member' };
    }
    const bot = await iam.getBot(input.id);
    if (!bot) {
      return { status: 404, error: 'Bot not found' };
    }
    const result = await iam.addBotRole(input.id, input.role, input.type);
    return { status: 201, data: result };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Remove a role from a bot account.
 *
 * @param input.id — unique identifier of the bot
 * @param input.role — role name to remove
 * @returns `{ status: 200, data: { removed: true } }` on success, or 404 if role not found
 */
export async function removeBotRole(input: {
  id: string;
  role: string;
}): Promise<LTApiResult> {
  try {
    const removed = await iam.removeBotRole(input.id, input.role);
    if (!removed) {
      return { status: 404, error: 'Role not found' };
    }
    return { status: 200, data: { removed: true } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * List all API keys for a bot account.
 *
 * @param input.id — unique identifier of the bot
 * @returns `{ status: 200, data: { keys: ApiKey[] } }` the bot's API keys, or 404 if bot not found
 */
export async function listBotKeys(input: {
  id: string;
}): Promise<LTApiResult> {
  try {
    const bot = await iam.getBot(input.id);
    if (!bot) {
      return { status: 404, error: 'Bot not found' };
    }
    const keys = await iam.listBotKeys(input.id);
    return { status: 200, data: { keys } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Create a new API key for a bot account.
 *
 * Returns 409 if an API key with the same name already exists for this bot.
 *
 * @param input.id — unique identifier of the bot
 * @param input.name — human-readable name for the API key (required)
 * @param input.scopes — optional list of permission scopes to restrict the key
 * @param input.expires_at — optional ISO 8601 expiration timestamp
 * @returns `{ status: 201, data: ApiKey }` the newly created API key (includes the secret)
 */
export async function createBotKey(input: {
  id: string;
  name: string;
  scopes?: string[];
  expires_at?: string;
}): Promise<LTApiResult> {
  try {
    if (!input.name) {
      return { status: 400, error: 'name is required' };
    }
    const expiresAt = input.expires_at ? new Date(input.expires_at) : undefined;
    const result = await iam.createBotKey(
      input.id,
      input.name,
      input.scopes || [],
      expiresAt,
    );
    return { status: 201, data: result };
  } catch (err: any) {
    if (err.message === 'Bot not found') {
      return { status: 404, error: err.message };
    }
    if (err.code === '23505') {
      return { status: 409, error: 'API key with this name already exists for this bot' };
    }
    return { status: 500, error: err.message };
  }
}

/**
 * Revoke an existing bot API key.
 *
 * @param input.keyId — unique identifier of the API key to revoke
 * @returns `{ status: 200, data: { revoked: true } }` on success, or 404 if key not found
 */
export async function revokeBotKey(input: {
  keyId: string;
}): Promise<LTApiResult> {
  try {
    const revoked = await iam.revokeBotKey(input.keyId);
    if (!revoked) {
      return { status: 404, error: 'API key not found' };
    }
    return { status: 200, data: { revoked: true } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
