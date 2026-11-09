import { describe, it, expect, vi, beforeEach } from 'vitest';

// The MCP resolve tools stamp the same review facets the HTTP paths do, so
// an agent's answer reports the same way a person's does.

const mocks = vi.hoisted(() => ({
  getEscalation: vi.fn(),
  resolveEscalation: vi.fn(),
  claimEscalation: vi.fn(),
}));
vi.mock('../../../services/escalation', async (io) => ({
  ...(await io<typeof import('../../../services/escalation')>()),
  getEscalation: mocks.getEscalation,
  resolveEscalation: mocks.resolveEscalation,
  claimEscalation: mocks.claimEscalation,
}));
vi.mock('../../../services/role/enforcement-cache', () => ({
  getEnforcingRoles: vi.fn(async () => new Set(['intake'])),
  getEnforcedFormSchema: vi.fn(async () => ({
    'x-lt-confidence': { tranches: [{ below: 0.6, label: 'Low', tone: 'error' }], facets: true },
    properties: { first_name: { type: 'string' } },
  })),
}));

import { createHumanQueueServer } from '../../../system/mcp-servers/human-queue';

const ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  role: 'intake',
  status: 'pending',
  metadata: {},
  envelope: JSON.stringify({ formDefaults: { first_name: 'Jon' }, confidence: { first_name: 0.52 } }),
  escalation_payload: null,
};
const FACETS = { review_outcome: 'corrected', review_changed: '1', review_worst: 'Low' };

async function tool(name: string) {
  const server = await createHumanQueueServer({ fresh: true, name: `review-facets-${name}` } as any);
  return (server as any)._registeredTools[name];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEscalation.mockResolvedValue(ROW);
  mocks.claimEscalation.mockResolvedValue(ROW);
  mocks.resolveEscalation.mockResolvedValue({ ...ROW, status: 'resolved' });
});

describe('human-queue review facets', () => {
  it('resolve_escalation passes the facets to the resolve', async () => {
    await (await tool('resolve_escalation')).handler({ escalation_id: ROW.id, payload: { first_name: 'John' } });
    expect(mocks.resolveEscalation).toHaveBeenCalledWith(ROW.id, { first_name: 'John' }, FACETS);
  });

  it('claim_and_resolve passes the facets to the resolve', async () => {
    await (await tool('claim_and_resolve')).handler({ escalation_id: ROW.id, resolver_id: 'agent', payload: { first_name: 'John' } });
    expect(mocks.resolveEscalation).toHaveBeenCalledWith(ROW.id, { first_name: 'John' }, FACETS);
  });
});
