import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api/escalations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/escalations')>()),
  openDurableWait: vi.fn(),
  cancelSingleEscalation: vi.fn(),
  bulkCancel: vi.fn(),
}));

import * as escalationsApi from '../../api/escalations';
import { createClient } from '../../sdk';

const BOT = { userId: 'bot-1' };
const WAIT = { workflowId: 'wf-1', waitKey: 'review', role: 'reviewer', type: 'order-review' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(escalationsApi.openDurableWait).mockResolvedValue({ status: 201, data: { escalationId: 'e-1', status: 'pending', created: true } });
  vi.mocked(escalationsApi.cancelSingleEscalation).mockResolvedValue({ status: 200, data: {} });
  vi.mocked(escalationsApi.bulkCancel).mockResolvedValue({ status: 200, data: { cancelled: 2, skipped: 0 } });
});

describe('createClient escalations: provider waits and cancel', () => {
  it('openWait calls the shared api with the client auth', async () => {
    const lt = createClient({ auth: BOT });
    const result = await lt.escalations.openWait(WAIT);
    expect(result.status).toBe(201);
    expect(escalationsApi.openDurableWait).toHaveBeenCalledWith(WAIT, BOT);
  });

  it('openWait takes a per-call auth override', async () => {
    const lt = createClient({ auth: BOT });
    await lt.escalations.openWait(WAIT, { userId: 'bot-2' });
    expect(escalationsApi.openDurableWait).toHaveBeenCalledWith(WAIT, { userId: 'bot-2' });
  });

  it('openWait answers 401 without auth and never calls the api', async () => {
    const result = await createClient().escalations.openWait(WAIT);
    expect(result).toEqual({ status: 401, error: 'Auth context required' });
    expect(escalationsApi.openDurableWait).not.toHaveBeenCalled();
  });

  it('cancel calls the shared api with the client auth', async () => {
    const lt = createClient({ auth: BOT });
    await lt.escalations.cancel({ id: 'e-1' });
    expect(escalationsApi.cancelSingleEscalation).toHaveBeenCalledWith({ id: 'e-1' }, BOT);
  });

  it('cancel returns the api result unchanged', async () => {
    vi.mocked(escalationsApi.cancelSingleEscalation).mockResolvedValue({ status: 409, error: 'Escalation is not cancellable (already terminal)' });
    const result = await createClient({ auth: BOT }).escalations.cancel({ id: 'e-1' });
    expect(result.status).toBe(409);
  });

  it('cancel answers 401 without auth', async () => {
    const result = await createClient().escalations.cancel({ id: 'e-1' });
    expect(result.status).toBe(401);
    expect(escalationsApi.cancelSingleEscalation).not.toHaveBeenCalled();
  });

  it('bulkCancel calls the shared api with the client auth', async () => {
    const result = await createClient({ auth: BOT }).escalations.bulkCancel({ ids: ['e-1', 'e-2'] });
    expect(result.data).toEqual({ cancelled: 2, skipped: 0 });
    expect(escalationsApi.bulkCancel).toHaveBeenCalledWith({ ids: ['e-1', 'e-2'] }, BOT);
  });
});
