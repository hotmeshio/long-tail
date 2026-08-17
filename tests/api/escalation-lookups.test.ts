import { describe, it, expect, vi, beforeEach } from 'vitest';

// The lookups endpoint: the refs on the row ARE the grant — readers of the
// escalation fetch exactly the pinned editions it names, nothing else.

vi.mock('../../services/escalation', () => ({
  getEscalation: vi.fn(),
}));
vi.mock('../../services/knowledge', () => ({
  resolveLookupRefs: vi.fn(),
}));
vi.mock('../../api/escalations/helpers', () => ({
  assertReadAccess: vi.fn(),
}));

import { getEscalationLookups } from '../../api/escalations/lookups';
import * as escalationService from '../../services/escalation';
import * as knowledgeService from '../../services/knowledge';
import { assertReadAccess } from '../../api/escalations/helpers';
import { assertLookupRefs } from '../../types/escalation';

const mockGet = vi.mocked(escalationService.getEscalation);
const mockResolve = vi.mocked(knowledgeService.resolveLookupRefs);
const mockRead = vi.mocked(assertReadAccess);

const AUTH = { userId: 'user-1' } as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getEscalationLookups', () => {
  it('resolves the pinned refs for a permitted reader', async () => {
    mockGet.mockResolvedValue({
      id: 'esc-1',
      role: 'catalog-picker',
      envelope: JSON.stringify({ lookups: [{ domain: 'catalog', key: 'materials', version: 2 }] }),
    } as any);
    mockRead.mockResolvedValue(null);
    mockResolve.mockResolvedValue([
      { domain: 'catalog', key: 'materials', version: 2, data: { items: ['a'] } },
    ]);

    const result = await getEscalationLookups({ id: 'esc-1' }, AUTH);
    expect(result.status).toBe(200);
    expect(result.data).toEqual({
      lookups: [{ domain: 'catalog', key: 'materials', version: 2, data: { items: ['a'] } }],
    });
  });

  it('denies a reader outside the escalation\'s scope with the guard\'s answer', async () => {
    mockGet.mockResolvedValue({ id: 'esc-1', role: 'other-role', envelope: '{}' } as any);
    mockRead.mockResolvedValue({ status: 403, error: 'Not authorized to view this escalation' });

    const result = await getEscalationLookups({ id: 'esc-1' }, AUTH);
    expect(result.status).toBe(403);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('404s an unknown escalation', async () => {
    mockGet.mockResolvedValue(null);
    const result = await getEscalationLookups({ id: 'ghost' }, AUTH);
    expect(result.status).toBe(404);
  });

  it('answers an empty list for rows without refs — no knowledge read at all', async () => {
    mockGet.mockResolvedValue({ id: 'esc-1', role: 'r', envelope: JSON.stringify({ formDefaults: {} }) } as any);
    mockRead.mockResolvedValue(null);

    const result = await getEscalationLookups({ id: 'esc-1' }, AUTH);
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ lookups: [] });
    expect(mockResolve).not.toHaveBeenCalled();
  });
});

describe('assertLookupRefs (creation-path contract)', () => {
  it('accepts well-formed refs', () => {
    expect(() => assertLookupRefs([
      { domain: 'catalog', key: 'materials', version: 1 },
      { domain: 'catalog', key: 'geo', version: 3, as: 'geography' },
    ])).not.toThrow();
  });

  it('rejects a missing/zero/float version — refs pin immutable editions', () => {
    expect(() => assertLookupRefs([{ domain: 'c', key: 'k' }])).toThrow(/positive integer version/);
    expect(() => assertLookupRefs([{ domain: 'c', key: 'k', version: 0 }])).toThrow(/positive integer version/);
    expect(() => assertLookupRefs([{ domain: 'c', key: 'k', version: 1.5 }])).toThrow(/positive integer version/);
  });

  it('rejects missing identity, empty alias, and non-array shapes', () => {
    expect(() => assertLookupRefs([{ key: 'k', version: 1 }])).toThrow(/domain and key/);
    expect(() => assertLookupRefs([{ domain: 'c', key: '', version: 1 }])).toThrow(/domain and key/);
    expect(() => assertLookupRefs([{ domain: 'c', key: 'k', version: 1, as: '' }])).toThrow(/"as"/);
    expect(() => assertLookupRefs({ domain: 'c' })).toThrow(/array/);
  });
});
