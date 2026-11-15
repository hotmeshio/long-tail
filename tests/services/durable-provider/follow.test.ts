import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const publishWorkflowEvent = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../lib/events/publish', () => ({ publishWorkflowEvent: (...a: unknown[]) => publishWorkflowEvent(...a) }));

const follows = new Map<string, string | null>();
const due: string[] = [];
vi.mock('../../../services/durable-provider/follow-store', () => ({
  recordFollow: async (_p: string, id: string, type: string) => { const created = !follows.has(id); follows.set(id, type || null); return created; },
  removeFollow: async (_p: string, id: string) => (follows.delete(id) ? { workflow_type: 'storedType' } : null),
  claimDueFollows: async () => due.splice(0).map((workflow_id) => ({ workflow_id, workflow_type: null })),
}));

import { WorkflowFollower } from '../../../services/durable-provider/follow';
import { JOB_STATE } from '../../../types/durable-provider';
import { FakeDurableProvider } from '../../helpers/fake-durable-provider';

const DELAYS = [10, 20, 40];

describe('WorkflowFollower', () => {
  let provider: FakeDurableProvider;
  let follower: WorkflowFollower;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    follows.clear();
    due.length = 0;
    provider = new FakeDurableProvider('dbos');
    follower = new WorkflowFollower(provider, DELAYS, 2);
  });
  afterEach(async () => {
    await follower.stop();
    vi.useRealTimers();
  });

  it('publishes workflow.completed when the engine reports the workflow closed', async () => {
    provider.setState('wf-1', JOB_STATE.COMPLETED);
    await follower.follow('wf-1', 'reviewOrder');
    await vi.advanceTimersByTimeAsync(10);
    expect(publishWorkflowEvent).toHaveBeenCalledWith({
      type: 'workflow.completed', source: 'durable-relay', workflowId: 'wf-1', workflowName: 'storedType', taskQueue: '', status: 'completed',
    });
    expect(follower.size).toBe(0);
  });

  it('keeps checking while the workflow runs, then publishes', async () => {
    await follower.follow('wf-2', 'reviewOrder');
    await vi.advanceTimersByTimeAsync(30);
    expect(publishWorkflowEvent).not.toHaveBeenCalled();
    provider.setState('wf-2', JOB_STATE.COMPLETED);
    await vi.advanceTimersByTimeAsync(40);
    expect(publishWorkflowEvent).toHaveBeenCalledTimes(1);
  });

  it('publishes workflow.failed for every unsuccessful close', async () => {
    for (const [id, state] of [['wf-f', JOB_STATE.FAILED], ['wf-t', JOB_STATE.TERMINATED]] as const) {
      provider.setState(id, state);
      await follower.follow(id, 'reviewOrder');
      await vi.advanceTimersByTimeAsync(10);
      expect(publishWorkflowEvent).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'workflow.failed', workflowId: id, status: state }));
    }
  });

  it('leaves a workflow still running after the last delay to the sweep', async () => {
    await follower.follow('wf-3', 'reviewOrder');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(publishWorkflowEvent).not.toHaveBeenCalled();
    expect(follower.size).toBe(0);
    expect(follows.has('wf-3')).toBe(true);

    due.push('wf-3');
    expect(await follower.sweep()).toBe(0);
    provider.setState('wf-3', JOB_STATE.FAILED);
    due.push('wf-3');
    expect(await follower.sweep()).toBe(1);
    expect(publishWorkflowEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'workflow.failed', workflowId: 'wf-3', workflowName: 'storedType' }));
    expect(follows.has('wf-3')).toBe(false);
  });

  it('publishes once when the follow was already removed', async () => {
    provider.setState('wf-7', JOB_STATE.COMPLETED);
    due.push('wf-7');
    expect(await follower.sweep()).toBe(0);
    expect(publishWorkflowEvent).not.toHaveBeenCalled();
  });

  it('the sweep removes a follow the engine does not know and carries on past a failed check', async () => {
    await follower.stop();
    follower = new WorkflowFollower(provider, [], 2);
    await follower.follow('wf-x', 't');
    await follower.follow('wf-y', 't');
    await follower.follow('wf-z', 't');
    provider.setState('wf-x', JOB_STATE.UNKNOWN);
    provider.setState('wf-z', JOB_STATE.COMPLETED);
    const real = provider.describe.bind(provider);
    vi.spyOn(provider, 'describe').mockImplementation(async (id) => {
      if (id === 'wf-y') throw new Error('engine down');
      return real(id);
    });
    due.push('wf-x', 'wf-y', 'wf-z');
    expect(await follower.sweep()).toBe(1);
    expect([...follows.keys()]).toEqual(['wf-y']);
  });

  it('publishes nothing for a workflow the engine does not know', async () => {
    provider.setState('wf-gone', JOB_STATE.UNKNOWN);
    await follower.follow('wf-gone', 'reviewOrder');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(publishWorkflowEvent).not.toHaveBeenCalled();
  });

  it('watches a workflow once at a time, caps how many it watches and stores every follow', async () => {
    await follower.follow('a', 't');
    await follower.follow('a', 't');
    await follower.follow('b', 't');
    await follower.follow('c', 't');
    expect(follower.size).toBe(2);
    expect([...follows.keys()]).toEqual(['a', 'b', 'c']);
  });

  it('retries on the next delay when describe throws', async () => {
    const describe = vi.spyOn(provider, 'describe').mockRejectedValueOnce(new Error('engine down'));
    provider.setState('wf-4', JOB_STATE.COMPLETED);
    await follower.follow('wf-4', 'reviewOrder');
    await vi.advanceTimersByTimeAsync(30);
    expect(describe).toHaveBeenCalledTimes(2);
    expect(publishWorkflowEvent).toHaveBeenCalledTimes(1);
  });

  it('stops every pending check', async () => {
    await follower.follow('wf-5', 'reviewOrder');
    await follower.stop();
    provider.setState('wf-5', JOB_STATE.COMPLETED);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(publishWorkflowEvent).not.toHaveBeenCalled();
    await follower.follow('wf-6', 'reviewOrder');
    expect(follower.size).toBe(0);
  });
});
