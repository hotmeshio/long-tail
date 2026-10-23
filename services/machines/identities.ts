/**
 * Identities inside Long Tail: each machine is a bot account holding its
 * station roles, so rows it claims and resolves name the machine. Bots are
 * found by name and given any role they are missing; nothing is removed. A
 * person's account under a bot's name stops the line from starting.
 */

import { addBotRole, createBot, getBotRoles } from '../iam';
import { getUser, getUserByExternalId, patchUserProperties } from '../user';
import type { LineDef } from '../../lib/machines/line';
import { CONTROLLER, type Actor } from './gateway/actions';
import type { AddressBook } from './gateway/address-book';
import { lineIdentities } from './gateway/provision';

/** The user property on a station's bot account that holds the address its machine registered. */
export const ADDRESS_PROPERTY = 'machineAddress';

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

/**
 * Learned addresses kept on each station's bot account, so a replica that
 * takes the line over sends to the machines the line already knows. An address
 * belongs to one station: binding it to a station clears it from any other.
 */
export class BotAddressBook implements AddressBook {
  constructor(private readonly bots: Map<Actor, string>) {}

  async load(): Promise<Map<string, string>> {
    const bound = new Map<string, string>();
    for (const [machineId, address] of await this.read()) if (address) bound.set(machineId, address);
    return bound;
  }

  async bind(machineId: string, address: string): Promise<void> {
    const id = this.bots.get(machineId);
    if (!id) throw new Error(`no bot for station "${machineId}"`);
    for (const [other, held] of await this.read()) {
      if (other !== machineId && held === address) await patchUserProperties(this.bots.get(other)!, { remove: [ADDRESS_PROPERTY] });
    }
    await patchUserProperties(id, { set: { [ADDRESS_PROPERTY]: address } });
  }

  private async read(): Promise<[string, string | undefined][]> {
    const stations = [...this.bots.entries()].filter(([actor]) => actor !== CONTROLLER);
    return Promise.all(stations.map(async ([machineId, id]) => {
      const address = (await getUser(id))?.metadata?.[ADDRESS_PROPERTY];
      return [machineId, typeof address === 'string' ? address : undefined] as [string, string | undefined];
    }));
  }
}
