import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../services/durable-provider/waits', () => ({
  openWait: vi.fn(),
  getWaitByEscalationId: vi.fn(),
}));
vi.mock('../../api/escalations/create', () => ({ assertCreatable: vi.fn().mockResolvedValue(null) }));

import { openDurableWait } from '../../api/escalations/waits';
import { durableProviderRegistry } from '../../services/durable-provider';
import { openWait } from '../../services/durable-provider/waits';
import { assertCreatable } from '../../api/escalations/create';
import { FakeDurableProvider } from '../helpers/fake-durable-provider';

const AUTH = { userId: '00000000-0000-4000-8000-000000000001' };
const BODY = { workflowId: 'wf-1', waitKey: 'review', role: 'reviewer', type: 'order-review' };

describe('POST /api/escalations/waits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    durableProviderRegistry.register(new FakeDurableProvider('temporal'));
    (openWait as any).mockResolvedValue({ escalation: { id: 'e-1', status: 'pending' }, created: true, reopened: false });
  });
  afterEach(() => durableProviderRegistry.clear());

  it('answers 501 when HotMesh runs workflows', async () => {
    durableProviderRegistry.clear();
    const result = await openDurableWait(BODY, AUTH as any);
    expect(result.status).toBe(501);
  });

  it('creates and returns 201', async () => {
    const result = await openDurableWait(BODY, AUTH as any);
    expect(result).toEqual({ status: 201, data: { escalationId: 'e-1', status: 'pending', created: true } });
    expect(openWait).toHaveBeenCalledWith('temporal', expect.objectContaining(BODY), AUTH.userId);
  });

  it('returns 200 for a repeat', async () => {
    (openWait as any).mockResolvedValue({ escalation: { id: 'e-1', status: 'pending' }, created: false, reopened: false });
    expect((await openDurableWait(BODY, AUTH as any)).status).toBe(200);
  });

  it.each([
    [{ ...BODY, workflowId: '' }, /workflowId/],
    [{ ...BODY, waitKey: 'x'.repeat(256) }, /waitKey/],
    [{ ...BODY, role: undefined }, /role/],
    [{ ...BODY, type: undefined }, /type/],
    [{ ...BODY, priority: 9 }, /priority/],
    [{ ...BODY, metadata: [] }, /metadata/],
    [{ ...BODY, expiresAt: 'soon' }, /expiresAt/],
  ])('rejects an invalid body with 400', async (body, message) => {
    const result = await openDurableWait(body as any, AUTH as any);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(message);
    expect(openWait).not.toHaveBeenCalled();
  });

  it('applies the create RBAC and metadata checks', async () => {
    (assertCreatable as any).mockResolvedValue({ status: 403, error: 'no write access' });
    const result = await openDurableWait(BODY, AUTH as any);
    expect(result.status).toBe(403);
    expect(assertCreatable).toHaveBeenCalledWith('reviewer', {}, AUTH);
    expect(openWait).not.toHaveBeenCalled();
  });
});
