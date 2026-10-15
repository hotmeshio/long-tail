import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../services/escalation', () => ({
  searchEscalationsFaceted: vi.fn(),
  searchEscalationsGrouped: vi.fn(),
  listEscalations: vi.fn(),
  listAvailableEscalations: vi.fn(),
}));
vi.mock('../../../api/escalations/helpers', () => ({ getEscalationReadScope: vi.fn() }));

import * as svc from '../../../services/escalation';
import { getEscalationReadScope } from '../../../api/escalations/helpers';
import { listEscalations, listAvailableEscalations } from '../../../api/escalations/list';

const grouped = vi.mocked(svc.searchEscalationsGrouped);
const auth = { userId: 'u1' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEscalationReadScope).mockResolvedValue({ global: false, allRoles: ['bin'], selfRoles: [] });
  grouped.mockResolvedValue({
    escalations: [{ id: 'a', envelope: '{}', escalation_payload: null }] as any,
    total: 1,
    groups: [{ key: 'A', ids: ['a'] }],
  });
});

describe('list paged by groups', () => {
  it('routes groupBy to the grouped search under the caller scope', async () => {
    const result = await listEscalations({ role: 'bin', status: 'pending', groupBy: 'binKey', limit: 10 }, auth);
    expect(result.status).toBe(200);
    expect(result.data.groups).toEqual([{ key: 'A', ids: ['a'] }]);
    expect(result.data.escalations[0]).not.toHaveProperty('envelope');
    expect(grouped.mock.calls[0][0]).toMatchObject({
      groupKey: 'binKey', visibleRoles: ['bin'], facet: { role: 'bin', status: 'pending' }, limit: 10,
    });
    expect(svc.searchEscalationsFaceted).not.toHaveBeenCalled();
  });

  it('pins the available pool when grouped', async () => {
    await listAvailableEscalations({ role: 'bin', groupBy: 'binKey' }, auth);
    expect(grouped.mock.calls[0][0].facet).toMatchObject({ status: 'pending', available: true });
  });

  it('refuses a groupBy that is not a metadata key', async () => {
    expect(await listEscalations({ groupBy: 'a.b' }, auth)).toEqual({
      status: 400, error: 'groupBy must be a metadata key (letters, numbers, underscores)',
    });
  });
});
