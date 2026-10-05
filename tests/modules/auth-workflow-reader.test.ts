import { describe, it, expect, vi, beforeEach } from 'vitest';

// requireWorkflowReader: a decision is 403 or next; a failed lookup is a 500.

const mayRead = vi.hoisted(() => vi.fn());
vi.mock('../../modules/capabilities', async (io) => ({
  ...(await io<typeof import('../../modules/capabilities')>()),
  mayReadWorkflowRun: mayRead,
}));

import { requireWorkflowReader } from '../../modules/auth';

const USER = '00000000-0000-4000-8000-0000000000a2';

async function run(auth?: Record<string, unknown>): Promise<{ status?: number; error?: string; next: boolean }> {
  const out: { status?: number; error?: string; next: boolean } = { next: false };
  const res = {
    status(code: number) { out.status = code; return this; },
    json(body: { error: string }) { out.error = body.error; },
  } as any;
  await requireWorkflowReader({ auth, params: { workflowId: 'wf-1' } } as any, res, () => { out.next = true; });
  return out;
}

describe('requireWorkflowReader', () => {
  beforeEach(() => { mayRead.mockReset(); });

  it('passes a caller who may read the run', async () => {
    mayRead.mockResolvedValue(true);
    expect(await run({ userId: USER })).toMatchObject({ next: true });
    expect(mayRead).toHaveBeenCalledWith({ userId: USER }, 'wf-1');
  });

  it('refuses a caller who may not, and an unauthenticated request', async () => {
    mayRead.mockResolvedValue(false);
    expect(await run({ userId: USER })).toEqual({ next: false, status: 403, error: 'Forbidden: workflow read access required' });
    expect(await run(undefined)).toEqual({ next: false, status: 403, error: 'Forbidden: workflow read access required' });
  });

  it('answers 500 when the lookup fails, and serves nothing', async () => {
    mayRead.mockImplementation(async () => { throw new Error('connection refused'); });
    expect(await run({ userId: USER })).toEqual({ next: false, status: 500, error: 'Workflow read check failed' });
  });
});
