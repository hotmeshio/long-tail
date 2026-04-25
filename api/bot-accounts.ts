import * as iam from '../services/iam';
import { isValidRoleType } from '../services/user';
import type { LTApiResult, LTApiAuth } from '../types/sdk';

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
