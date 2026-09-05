import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../../lib/db', () => ({ getPool: () => ({ query: mockQuery }) }));

import { getUserNames } from '../../../services/user';
import { GET_NAMES_BY_IDS } from '../../../services/user/sql';

const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';

beforeEach(() => mockQuery.mockReset());

describe('getUserNames', () => {
  it('drops non-uuid ids, dedupes, and queries only the clean set', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: U1, display_name: 'Dana', external_id: 'dana', email: null }] });

    const out = await getUserNames([U1, U1, 'not-a-uuid', U2, '']);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toBe(GET_NAMES_BY_IDS);
    expect(params[0]).toEqual([U1, U2]);
    expect(out).toHaveLength(1);
  });

  it('returns [] without touching the DB when no valid uuid is given', async () => {
    const out = await getUserNames(['nope', '', 'still-not-a-uuid']);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(out).toEqual([]);
  });
});

describe('GET_NAMES_BY_IDS projection', () => {
  it('selects display fields only — never a wildcard, secret, or metadata', () => {
    expect(GET_NAMES_BY_IDS).not.toMatch(/\*/);
    expect(GET_NAMES_BY_IDS).not.toMatch(/password_hash/);
    expect(GET_NAMES_BY_IDS).not.toMatch(/metadata/);
    expect(GET_NAMES_BY_IDS).not.toMatch(/read_scope|write_scope/);
    expect(GET_NAMES_BY_IDS).toMatch(/display_name/);
  });
});
