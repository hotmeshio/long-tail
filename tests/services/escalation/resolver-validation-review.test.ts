import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetEnforcingRoles = vi.fn();
const mockGetEnforcedFormSchema = vi.fn();
vi.mock('../../../services/role/enforcement-cache', () => ({
  getEnforcingRoles: (...args: any[]) => mockGetEnforcingRoles(...args),
  getEnforcedFormSchema: (...args: any[]) => mockGetEnforcedFormSchema(...args),
}));

import { assessResolverPayload } from '../../../services/escalation/resolver-validation';

// A passing answer on a form that opts into review facets returns the
// summary the resolve paths merge into the row's metadata.

const SCHEMA = {
  required: ['first_name'],
  'x-lt-confidence': { tranches: [{ below: 0.6, label: 'Low', tone: 'error' }], facets: true },
  properties: {
    first_name: { type: 'string', 'x-lt-bind': 'applicant.first_name' },
    city: { type: 'string' },
  },
};

const ENVELOPE = {
  formDefaults: { applicant: { first_name: 'Jon' }, city: 'Portland' },
  confidence: { applicant: { first_name: 0.52 }, city: 0.95 },
};

const row = (role = 'intake') => ({
  id: 'esc-1', role, metadata: {}, envelope: JSON.stringify(ENVELOPE), escalation_payload: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetEnforcingRoles.mockResolvedValue(new Set(['intake']));
  mockGetEnforcedFormSchema.mockResolvedValue(SCHEMA);
});

describe('assessResolverPayload review facets', () => {
  it('returns the review summary for a passing answer', async () => {
    const result = await assessResolverPayload(row(), { applicant: { first_name: 'John' }, city: 'Portland' });
    expect(result).toEqual({
      violation: null,
      facets: { review_outcome: 'corrected', review_changed: '1', review_worst: 'Low' },
    });
  });

  it('returns no facets with a violation', async () => {
    const result = await assessResolverPayload(row(), { city: 'Portland' });
    expect(result.violation!.violations).toEqual([{ field: 'first_name', message: 'Required' }]);
    expect(result.facets).toBeNull();
  });

  it('stamps nothing for a role that does not enforce its schema', async () => {
    const result = await assessResolverPayload(row('other'), { applicant: { first_name: 'John' } });
    expect(result).toEqual({ violation: null, facets: null });
    expect(mockGetEnforcedFormSchema).not.toHaveBeenCalled();
  });

  it('stamps nothing when the form does not opt in', async () => {
    mockGetEnforcedFormSchema.mockResolvedValue({ ...SCHEMA, 'x-lt-confidence': { tranches: [] } });
    const result = await assessResolverPayload(row(), { applicant: { first_name: 'John' } });
    expect(result.facets).toBeNull();
  });
});
