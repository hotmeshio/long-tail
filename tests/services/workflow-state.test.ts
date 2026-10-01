import { describe, it, expect, vi } from 'vitest';

import { readWorkflowState } from '../../services/workflow-state';

function handleWith(status: number, state: () => Promise<Record<string, any> | undefined>) {
  return { status: vi.fn().mockResolvedValue(status), state: vi.fn(state) };
}

describe('readWorkflowState', () => {
  it('a running job reads status only', async () => {
    const handle = handleWith(2, async () => ({}));
    expect(await readWorkflowState(handle)).toEqual({ status: 2, state: 'running', terminated: false });
    expect(handle.state).not.toHaveBeenCalled();
  });

  it('a closed job without an error is completed', async () => {
    const handle = handleWith(0, async () => ({ response: { ok: true } }));
    expect(await readWorkflowState(handle)).toEqual({ status: 0, state: 'completed', terminated: false });
  });

  it('a closed job carrying $error is failed with its message', async () => {
    const handle = handleWith(0, async () => ({ $error: { message: 'boom', code: 500 } }));
    expect(await readWorkflowState(handle)).toEqual({ status: 0, state: 'failed', terminated: false, error: 'boom' });
  });

  it('a terminated job is failed and flagged, with the interrupt message', async () => {
    const handle = handleWith(-1_000_000_001, async () => ({ $error: { message: 'Job Interrupted', code: 410 } }));
    expect(await readWorkflowState(handle)).toEqual({
      status: -1_000_000_001, state: 'failed', terminated: true, error: 'Job Interrupted',
    });
  });

  it('a terminated job with no readable outcome is still failed and flagged', async () => {
    const handle = handleWith(-1, async () => undefined);
    expect(await readWorkflowState(handle)).toEqual({ status: -1, state: 'failed', terminated: true });
  });

  it('a terminated job whose state read throws drops the read error', async () => {
    const handle = handleWith(-999_999_999, async () => { throw new Error('wf-9 Not Found'); });
    expect(await readWorkflowState(handle)).toEqual({ status: -999_999_999, state: 'failed', terminated: true });
  });

  it('a closed job whose state read throws is failed with that error', async () => {
    const handle = handleWith(0, async () => { throw new Error('job expired'); });
    expect(await readWorkflowState(handle)).toEqual({ status: 0, state: 'failed', terminated: false, error: 'job expired' });
  });

  it('a string $error is used as the message', async () => {
    const handle = handleWith(0, async () => ({ $error: 'plain failure' }));
    expect((await readWorkflowState(handle)).error).toBe('plain failure');
  });
});
