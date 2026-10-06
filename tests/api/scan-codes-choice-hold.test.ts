import { describe, it, expect, vi } from 'vitest';

// "Bin this" is a presented choice whose verb is hold: it lands on the hold
// executor with the row the screen showed, and writes nothing.
vi.mock('../../api/scan-codes/hold', () => ({ holdStep: vi.fn(async () => ({ status: 200, data: { outcome: 'held' } })) }));
vi.mock('../../api/escalations/metadata', () => ({ claimByMetadata: vi.fn(), resolveByMetadata: vi.fn(), restrictScopeRoles: vi.fn() }));
vi.mock('../../api/escalations/create', () => ({ createEscalation: vi.fn() }));
vi.mock('../../api/escalations/claim', () => ({ releaseEscalation: vi.fn() }));
vi.mock('../../api/escalations/helpers', () => ({ getEscalationReadScope: vi.fn(), getEscalationWriteScope: vi.fn() }));
vi.mock('../../services/escalation', () => ({ listEscalations: vi.fn(), cancelEscalation: vi.fn() }));

import { holdStep } from '../../api/scan-codes/hold';
import { claimByMetadata } from '../../api/escalations/metadata';
import { dispatchChoiceVerb } from '../../api/scan-codes/verbs';
import { SCAN_VERBS } from '../../types';

describe('dispatchChoiceVerb — hold', () => {
  it('holds the presented row with the choice params', async () => {
    const row = { id: 'bag-row', metadata: { orderSlug: 'K7Q2M9XA' } };
    const step = { query: {}, verb: SCAN_VERBS.HOLD, params: { hold: { ttlSeconds: 300 } } };
    const result = await dispatchChoiceVerb(step as any, {} as any, row);
    expect(result.data?.outcome).toBe('held');
    expect(holdStep).toHaveBeenCalledWith(step, {}, row);
    expect(claimByMetadata).not.toHaveBeenCalled();
  });
});
