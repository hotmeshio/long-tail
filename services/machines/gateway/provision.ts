/**
 * Identities. Each machine acts in Long Tail as its own bot account, so the
 * rows it claims and resolves name the machine beside the people who worked
 * the unit; the gateway's own bot (the controller) raises operator rows. At
 * boot the gateway logs in, makes sure every bot exists with its roles, and
 * mints a fresh session key per bot, revoking the previous one.
 */

import { clientIdOf } from '../../../lib/machines/protocol';
import { controllerId, exitRole, identOf, operatorRole, stationRoles, type LineDef } from '../../../lib/machines/line';
import { CONTROLLER, type Actor } from './actions';
import type { LtHttp } from './lt-http';

export const SESSION_KEY_NAME = 'machine-gateway-session';

export interface Identity {
  actor: Actor;
  botName: string;
  roles: string[];
}

/** The bots a line needs: one per machine, plus the controller. */
export function lineIdentities(line: LineDef): Identity[] {
  const stations = stationRoles(line);
  const machines = line.machines.map((m) => ({
    actor: m.machineId,
    botName: `machine-${clientIdOf(identOf(line, m.machineId))}`,
    roles: [...stations, exitRole(line)],
  }));
  const controller = {
    actor: CONTROLLER,
    botName: controllerId(line),
    roles: [...stations, exitRole(line), operatorRole(line)],
  };
  return [controller, ...machines];
}

/** A builder token: LT_GATEWAY_TOKEN when set, otherwise a username/password login. */
export async function adminToken(http: LtHttp, env: Record<string, string | undefined>): Promise<string> {
  if (env.LT_GATEWAY_TOKEN) return env.LT_GATEWAY_TOKEN;
  const username = env.LT_GATEWAY_USERNAME;
  const password = env.LT_GATEWAY_PASSWORD;
  if (!username || !password) throw new Error('the gateway needs LT_GATEWAY_TOKEN, or LT_GATEWAY_USERNAME and LT_GATEWAY_PASSWORD');
  const { token } = await http.request<{ token: string }>('POST', '/auth/login', null, { username, password });
  return token;
}

async function ensureBot(http: LtHttp, admin: string, identity: Identity): Promise<string> {
  const page = await http.request<{ bots: { id: string; external_id: string }[] }>(
    'GET', `/bot-accounts?search=${encodeURIComponent(identity.botName)}&limit=50`, admin,
  );
  const found = page.bots.find((b) => b.external_id === identity.botName);
  if (found) {
    const { roles } = await http.request<{ roles: { role: string }[] }>('GET', `/bot-accounts/${found.id}/roles`, admin);
    const held = new Set(roles.map((r) => r.role));
    for (const role of identity.roles.filter((r) => !held.has(r))) {
      await http.request('POST', `/bot-accounts/${found.id}/roles`, admin, { role, type: 'member' });
    }
    return found.id;
  }
  const bot = await http.request<{ id: string }>('POST', '/bot-accounts', admin, {
    name: identity.botName,
    display_name: identity.actor === CONTROLLER ? 'Line controller' : identity.actor,
    description: identity.actor === CONTROLLER ? 'Machine gateway: raises line-operator rows' : `Machine ${identity.actor} on the line`,
    roles: identity.roles.map((role) => ({ role, type: 'member' })),
  });
  return bot.id;
}

async function mintSessionKey(http: LtHttp, admin: string, botId: string): Promise<string> {
  const { keys } = await http.request<{ keys: { id: string; name: string }[] }>('GET', `/bot-accounts/${botId}/api-keys`, admin);
  for (const key of keys.filter((k) => k.name === SESSION_KEY_NAME)) {
    await http.request('DELETE', `/bot-accounts/${botId}/api-keys/${key.id}`, admin);
  }
  const { rawKey } = await http.request<{ rawKey: string }>('POST', `/bot-accounts/${botId}/api-keys`, admin, { name: SESSION_KEY_NAME });
  return rawKey;
}

/** Ensure every bot and mint its session key; returns actor → bearer token. */
export async function provisionIdentities(http: LtHttp, admin: string, line: LineDef): Promise<Map<Actor, string>> {
  const tokens = new Map<Actor, string>();
  for (const identity of lineIdentities(line)) {
    const botId = await ensureBot(http, admin, identity);
    tokens.set(identity.actor, await mintSessionKey(http, admin, botId));
  }
  return tokens;
}
