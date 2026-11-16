import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { Client } from 'pg';

import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import * as userService from '../../../services/user';
import { generateBotApiKey, validateBotApiKey, revokeBotApiKey } from '../../../services/auth/bot-api-key';
import { digestKey } from '../../../services/auth/key-digest';

// A bot key is validated by one indexed read: the key must be unexpired and
// its bot active, and the bot's current roles come back in the same row.
const STAMP = `${Date.now()}-botkey`;
const ROLE = `botkey-${STAMP}`;
const EXTRA_ROLE = `botkey-extra-${STAMP}`;
const KEY_TABLE = /lt_bot_api_keys/;
let botId: string;
const originalQuery = Client.prototype.query;

const keyRow = async (id: string) =>
  (await getPool().query('SELECT key_digest, last_used_at FROM lt_bot_api_keys WHERE id = $1', [id])).rows[0];
const settle = () => new Promise((r) => setTimeout(r, 100));

/** Run with every statement on every connection recorded. */
async function recordStatements(run: () => Promise<unknown>): Promise<string[]> {
  const statements: string[] = [];
  (Client.prototype as any).query = function (this: Client, ...args: any[]) {
    const text = typeof args[0] === 'string' ? args[0] : args[0]?.text;
    if (text) statements.push(String(text).replace(/\s+/g, ' ').trim());
    return (originalQuery as any).apply(this, args);
  };
  try {
    await run();
    await settle();
  } finally {
    Client.prototype.query = originalQuery;
  }
  return statements.filter((q) => KEY_TABLE.test(q));
}

/** A key as stored before digests existed. */
async function mintWithoutDigest(): Promise<{ id: string; rawKey: string }> {
  const key = await generateBotApiKey(`legacy-${Math.random()}`, botId, []);
  await getPool().query('UPDATE lt_bot_api_keys SET key_digest = NULL WHERE id = $1', [key.id]);
  return key;
}

beforeAll(async () => {
  await migrate();
  const bot = await userService.createUser({
    external_id: `botkey-${STAMP}`,
    roles: [{ role: ROLE, type: 'member', read_scope: 'all', write_scope: 'all' } as any],
  });
  botId = bot.id;
}, 30_000);

afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await getPool().query('DELETE FROM lt_users WHERE id = $1', [botId]); });

describe('bot API key: validation', () => {
  it('a minted key stores its digest and validates without bcrypt', async () => {
    const { id, rawKey } = await generateBotApiKey('fresh', botId, ['mcp:read']);
    expect((await keyRow(id)).key_digest).toBe(digestKey(rawKey));
    const compare = vi.spyOn(bcrypt, 'compare');
    const key = await validateBotApiKey(rawKey);
    expect(key).toMatchObject({ id, name: 'fresh', user_id: botId, scopes: ['mcp:read'] });
    expect(key?.roles).toEqual([{ role: ROLE, type: 'member' }]);
    expect(compare).not.toHaveBeenCalled();
  });

  it('a recently used key costs one read and no write', async () => {
    const { rawKey } = await generateBotApiKey('steady', botId);
    await validateBotApiKey(rawKey);
    await settle();
    const statements = await recordStatements(() => validateBotApiKey(rawKey));
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^SELECT/);
  });

  it('answers with the bot\'s current roles', async () => {
    const { rawKey } = await generateBotApiKey('roles', botId);
    await userService.addUserRole(botId, EXTRA_ROLE, 'admin', { read_scope: 'all', write_scope: 'all' });
    expect((await validateBotApiKey(rawKey))?.roles).toContainEqual({ role: EXTRA_ROLE, type: 'admin' });
    await userService.removeUserRole(botId, EXTRA_ROLE);
    expect((await validateBotApiKey(rawKey))?.roles.map((r) => r.role)).not.toContain(EXTRA_ROLE);
  });

  it('refuses a wrong prefix without a read, and an unknown key', async () => {
    const statements = await recordStatements(async () => {
      expect(await validateBotApiKey('lt_svc_abc')).toBeNull();
    });
    expect(statements).toEqual([]);
    expect(await validateBotApiKey(`lt_bot_${'0'.repeat(64)}`)).toBeNull();
  });

  it('refuses a key of the wrong shape without a read', async () => {
    const statements = await recordStatements(async () => {
      expect(await validateBotApiKey('lt_bot_abc')).toBeNull();
      expect(await validateBotApiKey(`lt_bot_${'G'.repeat(64)}`)).toBeNull();
      expect(await validateBotApiKey(`lt_bot_${'0'.repeat(65)}`)).toBeNull();
    });
    expect(statements).toEqual([]);
  });

  it('refuses an expired key and a revoked key', async () => {
    const expired = await generateBotApiKey('expired', botId, [], new Date(Date.now() - 1000));
    expect(await validateBotApiKey(expired.rawKey)).toBeNull();
    const revoked = await generateBotApiKey('revoked', botId);
    expect(await validateBotApiKey(revoked.rawKey)).not.toBeNull();
    await revokeBotApiKey(revoked.id);
    expect(await validateBotApiKey(revoked.rawKey)).toBeNull();
  });

  it('refuses the key of an inactive bot, and accepts it again on reactivation', async () => {
    const { rawKey } = await generateBotApiKey('status', botId);
    await getPool().query(`UPDATE lt_users SET status = 'inactive' WHERE id = $1`, [botId]);
    expect(await validateBotApiKey(rawKey)).toBeNull();
    await getPool().query(`UPDATE lt_users SET status = 'active' WHERE id = $1`, [botId]);
    expect(await validateBotApiKey(rawKey)).not.toBeNull();
  });
});

describe('bot API key: keys stored without a digest', () => {
  it('validates on first use, gains its digest, and skips bcrypt from then on', async () => {
    const { id, rawKey } = await mintWithoutDigest();
    const compare = vi.spyOn(bcrypt, 'compare');
    expect((await validateBotApiKey(rawKey))?.id).toBe(id);
    expect(compare).toHaveBeenCalled();
    expect((await keyRow(id)).key_digest).toBe(digestKey(rawKey));
    compare.mockClear();
    expect((await validateBotApiKey(rawKey))?.id).toBe(id);
    expect(compare).not.toHaveBeenCalled();
  });

  it('refuses the key of an inactive bot on first use', async () => {
    const { rawKey } = await mintWithoutDigest();
    await getPool().query(`UPDATE lt_users SET status = 'inactive' WHERE id = $1`, [botId]);
    try {
      expect(await validateBotApiKey(rawKey)).toBeNull();
    } finally {
      await getPool().query(`UPDATE lt_users SET status = 'active' WHERE id = $1`, [botId]);
    }
  });
});

describe('bot API key: last_used_at', () => {
  it('is stamped on first use and left alone within the interval', async () => {
    const { id, rawKey } = await generateBotApiKey('stamp', botId);
    expect((await keyRow(id)).last_used_at).toBeNull();
    await validateBotApiKey(rawKey);
    await settle();
    const first = (await keyRow(id)).last_used_at;
    expect(first).toBeInstanceOf(Date);
    await validateBotApiKey(rawKey);
    await settle();
    expect((await keyRow(id)).last_used_at).toEqual(first);
  });

  it('is stamped again once the interval has passed', async () => {
    const { id, rawKey } = await generateBotApiKey('restamp', botId);
    await getPool().query(`UPDATE lt_bot_api_keys SET last_used_at = NOW() - interval '1 hour' WHERE id = $1`, [id]);
    const before = (await keyRow(id)).last_used_at as Date;
    await validateBotApiKey(rawKey);
    await settle();
    expect(((await keyRow(id)).last_used_at as Date).getTime()).toBeGreaterThan(before.getTime());
  });
});
