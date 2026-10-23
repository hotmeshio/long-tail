import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { migrate } from '../../../lib/db/migrate';
import { getBotRoles, removeBotRole } from '../../../services/iam';
import { createUser, deleteUser, getUser } from '../../../services/user';
import { ADDRESS_PROPERTY, BotAddressBook, ensureLineBots } from '../../../services/machines/identities';
import { lineIdentities } from '../../../services/machines/gateway/provision';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';

const LINE = { ...DEFAULT_LINE, lineId: `id-${Date.now().toString(36)}` };
let ids: Map<string, string>;

describe('machine identities in process', () => {
  beforeAll(async () => {
    await migrate();
    ids = await ensureLineBots(LINE);
  }, 30_000);

  afterAll(async () => {
    for (const id of new Set(ids.values())) await deleteUser(id);
  });

  it('creates one bot per machine plus the controller, each on its roles', async () => {
    expect([...ids.keys()]).toEqual(['controller', 'press-01', 'cut-01', 'inspect-01']);
    const press = (await getBotRoles(ids.get('press-01')!)).map((r) => r.role).sort();
    expect(press).toEqual(['line-bond', 'line-exit', 'line-inspect', 'line-trim']);
    expect((await getBotRoles(ids.get('controller')!)).map((r) => r.role)).toContain('line-operator');
  });

  it('reuses the bots on the next boot and gives back a role that went missing', async () => {
    await removeBotRole(ids.get('cut-01')!, 'line-exit');
    const again = await ensureLineBots(LINE);
    expect(again).toEqual(ids);
    expect((await getBotRoles(ids.get('cut-01')!)).map((r) => r.role)).toContain('line-exit');
  });

  it('refuses to act as a person whose account carries a bot\'s name', async () => {
    const line = { ...DEFAULT_LINE, lineId: `id-person-${Date.now().toString(36)}` };
    const person = await createUser({ external_id: lineIdentities(line)[0].botName, display_name: 'Someone' });
    try {
      await expect(ensureLineBots(line)).rejects.toThrow(/person's account/);
      expect(await getBotRoles(person.id)).toEqual([]);
    } finally {
      await deleteUser(person.id);
    }
  });

  it('keeps each learned address on its station\'s bot account, one station per address', async () => {
    const book = new BotAddressBook(ids);
    const uuid = '8f77e321-53de-4a60-988b-27f4b46a922d';
    await book.bind('press-01', uuid);
    expect((await getUser(ids.get('press-01')!))!.metadata?.[ADDRESS_PROPERTY]).toBe(uuid);
    await book.bind('cut-01', uuid);
    expect([...(await new BotAddressBook(ids).load())]).toEqual([['cut-01', uuid]]);
    expect((await getUser(ids.get('press-01')!))!.metadata?.[ADDRESS_PROPERTY]).toBeUndefined();
  });
});
