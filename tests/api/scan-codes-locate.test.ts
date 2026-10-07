import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api/escalations/helpers', () => ({ getEscalationReadScope: vi.fn() }));
vi.mock('../../services/escalation', () => ({ searchByFacets: vi.fn(), listEscalations: vi.fn() }));

import { getEscalationReadScope } from '../../api/escalations/helpers';
import * as escalationService from '../../services/escalation';
import { locateForStep } from '../../api/scan-codes/locate';
import type { ScanStep } from '../../types';

const search = vi.mocked(escalationService.searchByFacets);
const list = vi.mocked(escalationService.listEscalations);
const ctx = {
  scheme: { version: 14, target_facet: 'binCode' },
  parsed: { version: 14, category: '1', target: 'SF-A-2' },
  auth: { userId: 'maria' },
} as any;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEscalationReadScope).mockResolvedValue({ global: false, allRoles: ['bin'], selfRoles: [] } as any);
  search.mockResolvedValue({ escalations: [], total: 0 });
  list.mockResolvedValue({ escalations: [], total: 0 });
});

describe('locateForStep', () => {
  it('narrows the search by query types and subtypes', async () => {
    const step: ScanStep = { query: { roles: ['bin'], types: ['bin'], subtypes: ['packing'] }, verb: 'hold' };
    await locateForStep(step, ctx, 1);
    expect(search).toHaveBeenCalledWith(expect.objectContaining({
      roles: ['bin'], types: ['bin'], subtypes: ['packing'], facets: { binCode: 'SF-A-2' }, status: 'pending',
    }));
  });

  it('a step without types or subtypes searches as before', async () => {
    await locateForStep({ query: { roles: ['bin'] }, verb: 'show-detail' }, ctx, 2);
    const args = search.mock.calls[0][0];
    expect(args.types).toBeUndefined();
    expect(args.subtypes).toBeUndefined();
  });

  it("availability 'mine' passes the single type and subtype to the claim list", async () => {
    const step: ScanStep = { query: { roles: ['bin'], availability: 'mine', types: ['bin'], subtypes: ['open'] }, verb: 'show-detail' };
    await locateForStep(step, ctx, 1);
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ type: 'bin', subtype: 'open', assigned_to: 'maria' }));
  });

  it('a scope with no matching roles locates nothing', async () => {
    expect(await locateForStep({ query: { roles: ['ship'] }, verb: 'show-detail' }, ctx, 1)).toBeNull();
    expect(search).not.toHaveBeenCalled();
  });
});
