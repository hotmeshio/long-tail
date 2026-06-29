import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();

vi.mock('../../../lib/db', () => ({
  getPool: () => ({ query: mockQuery }),
}));

// schema-exchange pulls in iam at import; neutralize its side effects but keep
// the real Ajv-backed validateSchemaDocument so schema rejection is genuine.
vi.mock('../../../services/iam/context', () => ({ getToolContext: vi.fn() }));
vi.mock('../../../services/iam/credentials', () => ({ resolveCredential: vi.fn() }));

import {
  getRoleDials,
  upsertRoleDial,
  deleteRoleDial,
  updateRoleConfig,
} from '../../../services/role';

beforeEach(() => {
  mockQuery.mockReset();
});

describe('upsertRoleDial', () => {
  it('issues exactly one ON CONFLICT upsert with the per-unit TAT target', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });
    await upsertRoleDial('printer-pool-standard', 'gluing', { targetTatSeconds: 60 });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/ON CONFLICT \(role, station_key\) DO UPDATE/);
    expect(params).toEqual(['printer-pool-standard', 'gluing', 60]);
  });
});

describe('getRoleDials', () => {
  it('returns the role dial rows in one query', async () => {
    const rows = [{ role: 'r', station_key: 'a', target_tat_seconds: 90 }];
    mockQuery.mockResolvedValue({ rows });
    const dials = await getRoleDials('r');
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][1]).toEqual(['r']);
    expect(dials).toEqual(rows);
  });
});

describe('deleteRoleDial', () => {
  it('returns true when a row was removed', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });
    expect(await deleteRoleDial('r', 'a')).toBe(true);
    expect(mockQuery.mock.calls[0][1]).toEqual(['r', 'a']);
  });

  it('returns false when nothing matched', async () => {
    mockQuery.mockResolvedValue({ rowCount: 0 });
    expect(await deleteRoleDial('r', 'missing')).toBe(false);
  });
});

describe('updateRoleConfig', () => {
  it('rejects an uncompilable metadata schema BEFORE any DB write', async () => {
    await expect(
      updateRoleConfig('r', { metadataSchema: { type: 'not-a-real-type' } }),
    ).rejects.toThrow(/Invalid metadata_schema/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('persists a valid patch in one statement, serializing the schema', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });
    const schema = { type: 'object', properties: { station: { type: 'string' } } };
    await updateRoleConfig('printer-pool-standard', {
      title: 'Standard Printers',
      purpose: 'Non-diabetic insole printing',
      metadataSchema: schema,
      homeView: 'overview',
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toBe('printer-pool-standard');
    expect(params[1]).toBe('Standard Printers');
    expect(params[2]).toBe('Non-diabetic insole printing');
    expect(JSON.parse(params[3])).toEqual(schema);
    expect(params[4]).toBe('overview');
  });

  it('passes nulls for omitted fields so COALESCE preserves them', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });
    await updateRoleConfig('r', { title: 'Just a title' });
    expect(mockQuery.mock.calls[0][1]).toEqual(['r', 'Just a title', null, null, null]);
  });
});
