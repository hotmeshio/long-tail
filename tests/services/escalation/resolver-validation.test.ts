import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetEnforcingRoles = vi.fn();
const mockGetEnforcedFormSchema = vi.fn();
vi.mock('../../../services/role/enforcement-cache', () => ({
  getEnforcingRoles: (...args: any[]) => mockGetEnforcingRoles(...args),
  getEnforcedFormSchema: (...args: any[]) => mockGetEnforcedFormSchema(...args),
}));

import { checkResolverPayload, toValidationErrorBody } from '../../../services/escalation/resolver-validation';
import { LT_ERROR_CODES } from '../../../types/validation';

const SCHEMA = {
  required: ['status'],
  properties: {
    status: { type: 'string', enum: ['done', 'blocked'] },
    count: { type: 'integer' },
  },
};

function makeRow(overrides: Record<string, any> = {}): any {
  return {
    id: 'esc-1',
    role: 'station-a',
    metadata: {},
    envelope: JSON.stringify({ items: [] }),
    escalation_payload: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetEnforcingRoles.mockResolvedValue(new Set(['station-a']));
  mockGetEnforcedFormSchema.mockResolvedValue(SCHEMA);
});

describe('checkResolverPayload', () => {
  it('returns null without any schema read when the role does not enforce', async () => {
    mockGetEnforcingRoles.mockResolvedValue(new Set());
    const result = await checkResolverPayload(makeRow(), {});
    expect(result).toBeNull();
    expect(mockGetEnforcedFormSchema).not.toHaveBeenCalled();
  });

  it('returns null when the enforcing role declares no schema', async () => {
    mockGetEnforcedFormSchema.mockResolvedValue(null);
    expect(await checkResolverPayload(makeRow(), {})).toBeNull();
  });

  it('reports violations with role and pinned version', async () => {
    const row = makeRow({ metadata: { schema_version: 3 } });
    const report = await checkResolverPayload(row, { count: 'two' });
    expect(report).not.toBeNull();
    expect(report!.role).toBe('station-a');
    expect(report!.schemaVersion).toBe(3);
    expect(report!.violations).toEqual([
      { field: 'status', message: 'Required' },
      { field: 'count', message: 'Expected a whole number' },
    ]);
    expect(mockGetEnforcedFormSchema).toHaveBeenCalledWith('station-a', 3);
  });

  it('passes a conforming payload', async () => {
    expect(await checkResolverPayload(makeRow(), { status: 'done', count: 2 })).toBeNull();
  });

  it('prefers the row-embedded metadata.form_schema over the role schema', async () => {
    const row = makeRow({
      metadata: { form_schema: { required: ['ack'], properties: { ack: { type: 'boolean' } } } },
    });
    const report = await checkResolverPayload(row, {});
    expect(report!.violations).toEqual([{ field: 'ack', message: 'Required' }]);
    expect(mockGetEnforcedFormSchema).not.toHaveBeenCalled();
  });

  it('parses a string schema_version pin like the SQL guarded cast', async () => {
    await checkResolverPayload(makeRow({ metadata: { schema_version: '7' } }), { status: 'done' });
    expect(mockGetEnforcedFormSchema).toHaveBeenCalledWith('station-a', 7);
  });

  it('feeds the row envelope into require-all checklist resolution', async () => {
    mockGetEnforcedFormSchema.mockResolvedValue({
      required: [],
      properties: {
        checks: {
          'x-lt-widget': 'checklist',
          'x-lt-require-all': true,
          'x-lt-source': 'envelope.items',
        },
      },
    });
    const row = makeRow({ envelope: JSON.stringify({ items: [{ id: 'a', label: 'A' }] }) });
    const report = await checkResolverPayload(row, { checks: {} });
    expect(report!.violations[0].message).toBe('1 of 1 checks incomplete');
  });

  it('invokes the envelope loader only for enforcing roles', async () => {
    const loader = vi.fn(async () => ({ items: [] }));
    await checkResolverPayload(makeRow(), { status: 'done' }, loader);
    expect(loader).toHaveBeenCalledTimes(1);

    loader.mockClear();
    mockGetEnforcingRoles.mockResolvedValue(new Set());
    await checkResolverPayload(makeRow(), { status: 'done' }, loader);
    expect(loader).not.toHaveBeenCalled();
  });
});

describe('toValidationErrorBody', () => {
  it('produces the canonical 422 body', () => {
    const body = toValidationErrorBody({
      role: 'station-a',
      schemaVersion: 2,
      violations: [{ field: 'status', message: 'Required' }],
    });
    expect(body).toEqual({
      error: 'resolverPayload failed schema validation (1 violation)',
      code: LT_ERROR_CODES.SCHEMA_VALIDATION,
      violations: [{ field: 'status', message: 'Required' }],
      role: 'station-a',
      schemaVersion: 2,
    });
  });
});
