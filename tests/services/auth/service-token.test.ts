import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import bcrypt from 'bcryptjs';

import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import { generateServiceToken, validateServiceToken, revokeServiceToken } from '../../../services/auth/service-token';
import { digestKey } from '../../../services/auth/key-digest';

const STAMP = `${Date.now()}-svc`;
const minted: string[] = [];

const tokenRow = async (id: string) =>
  (await getPool().query('SELECT token_digest, last_used_at FROM lt_service_tokens WHERE id = $1', [id])).rows[0];
const settle = () => new Promise((r) => setTimeout(r, 100));

async function mint(name: string, scopes: string[] = [], expiresAt?: Date) {
  const token = await generateServiceToken(`${name}-${STAMP}`, null, scopes, expiresAt);
  minted.push(token.id);
  return token;
}

beforeAll(async () => { await migrate(); }, 30_000);
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await getPool().query('DELETE FROM lt_service_tokens WHERE id = ANY($1)', [minted]); });

describe('service token: validation', () => {
  it('a minted token stores its digest and validates without bcrypt', async () => {
    const { id, rawToken } = await mint('fresh', ['delegation:validate']);
    expect((await tokenRow(id)).token_digest).toBe(digestKey(rawToken));
    const compare = vi.spyOn(bcrypt, 'compare');
    const record = await validateServiceToken(rawToken);
    expect(record).toMatchObject({ id, name: `fresh-${STAMP}`, server_id: null, scopes: ['delegation:validate'] });
    expect(record).not.toHaveProperty('token_hash');
    expect(record).not.toHaveProperty('stamp_due');
    expect(compare).not.toHaveBeenCalled();
  });

  it('refuses a wrong prefix, an unknown token, an expired token and a revoked token', async () => {
    expect(await validateServiceToken('lt_bot_abc')).toBeNull();
    expect(await validateServiceToken(`lt_svc_${'0'.repeat(64)}`)).toBeNull();
    const expired = await mint('expired', [], new Date(Date.now() - 1000));
    expect(await validateServiceToken(expired.rawToken)).toBeNull();
    const revoked = await mint('revoked');
    await revokeServiceToken(revoked.id);
    expect(await validateServiceToken(revoked.rawToken)).toBeNull();
  });

  it('a token stored without a digest validates, gains its digest, and skips bcrypt from then on', async () => {
    const { id, rawToken } = await mint('legacy');
    await getPool().query('UPDATE lt_service_tokens SET token_digest = NULL WHERE id = $1', [id]);
    const compare = vi.spyOn(bcrypt, 'compare');
    expect((await validateServiceToken(rawToken))?.id).toBe(id);
    expect(compare).toHaveBeenCalled();
    expect((await tokenRow(id)).token_digest).toBe(digestKey(rawToken));
    compare.mockClear();
    expect((await validateServiceToken(rawToken))?.id).toBe(id);
    expect(compare).not.toHaveBeenCalled();
  });

  it('stamps last_used_at on first use and leaves it alone within the interval', async () => {
    const { id, rawToken } = await mint('stamp');
    await validateServiceToken(rawToken);
    await settle();
    const first = (await tokenRow(id)).last_used_at;
    expect(first).toBeInstanceOf(Date);
    await validateServiceToken(rawToken);
    await settle();
    expect((await tokenRow(id)).last_used_at).toEqual(first);
  });
});
