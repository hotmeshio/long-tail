/**
 * Identities inside Long Tail: each machine is a bot account holding its
 * station roles, so rows it claims and resolves name the machine. Bots are
 * found by name and given any role they are missing; nothing is removed. A
 * person's account under a bot's name stops the line from starting.
 */

import { addBotRole, createBot, getBotRoles } from '../iam';
import { getUserByExternalId } from '../user';
import type { LineDef } from '../../lib/machines/line';
import type { Actor } from './gateway/actions';
import { lineIdentities } from './gateway/provision';

const MEMBER = 'member' as const;
const BOT = 'bot' as const;

/** Make sure every bot the line needs exists with its roles; returns actor → user id. */
export async function ensureLineBots(line: LineDef): Promise<Map<Actor, string>> {
  const ids = new Map<Actor, string>();
  for (const identity of lineIdentities(line)) {
    const existing = await getUserByExternalId(identity.botName);
    if (existing && existing.account_type !== BOT) {
      throw new Error(`"${identity.botName}" belongs to a person's account; the gateway acts only as bot accounts`);
    }
    if (!existing) {
      const bot = await createBot({
        name: identity.botName,
        description: `Machine line ${line.siteId}/${line.lineId}: ${identity.actor}`,
        roles: identity.roles.map((role) => ({ role, type: MEMBER })),
      });
      ids.set(identity.actor, bot.id);
      continue;
    }
    const held = new Set((await getBotRoles(existing.id)).map((r) => r.role));
    for (const role of identity.roles.filter((r) => !held.has(r))) await addBotRole(existing.id, role, MEMBER);
    ids.set(identity.actor, existing.id);
  }
  return ids;
}
