import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetEnforcingRoles = vi.fn();
const mockGetEnforcedFormSchema = vi.fn();
vi.mock('../../../services/role/enforcement-cache', () => ({
  getEnforcingRoles: (...args: any[]) => mockGetEnforcingRoles(...args),
  getEnforcedFormSchema: (...args: any[]) => mockGetEnforcedFormSchema(...args),
}));

import { checkResolverPayload } from '../../../services/escalation/resolver-validation';

// The server gate sees the `file` domain the form sees, so a field shown
// because a document is attached is demanded on both sides of the wire, and
// the document field itself never is.

const SCHEMA = {
  required: ['page_count'],
  properties: {
    referral: { type: 'string', 'x-lt-widget': 'document', 'x-lt-source': 'file.referral' },
    page_count: { type: 'number', 'x-lt-showIf': 'file.referral' },
  },
};

const row = (envelope: unknown) => ({
  id: 'esc-1', role: 'intake', metadata: {}, envelope: JSON.stringify(envelope), escalation_payload: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetEnforcingRoles.mockResolvedValue(new Set(['intake']));
  mockGetEnforcedFormSchema.mockResolvedValue(SCHEMA);
});

describe('checkResolverPayload with stored files', () => {
  it('demands a field shown by an attached document', async () => {
    const report = await checkResolverPayload(row({ files: [{ path: 'r.pdf', as: 'referral' }] }), {});
    expect(report!.violations).toEqual([{ field: 'page_count', message: 'Required' }]);
    expect(await checkResolverPayload(row({ files: [{ path: 'r.pdf', as: 'referral' }] }), { page_count: 3 })).toBeNull();
  });

  it('leaves it alone when nothing is attached', async () => {
    expect(await checkResolverPayload(row({}), {})).toBeNull();
  });
});
