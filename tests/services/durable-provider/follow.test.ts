import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const publishWorkflowEvent = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../lib/events/publish', () => ({ publishWorkflowEvent: (...a: unknown[]) => publishWorkflowEvent(...a) }));

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
    provider = new FakeDurableProvider('dbos');
    follower = new WorkflowFollower(provider, DELAYS, 2);
  });
  afterEach(() => {
    follower.stop();
    vi.useRealTimers();
  });

  it('publishes workflow.completed when the engine reports the workflow closed', async () => {
    provider.setState('wf-1', JOB_STATE.COMPLETED);
    follower.follow('wf-1', 'reviewOrder');
    await vi.advanceTimersByTimeAsync(10);
    expect(publishWorkflowEvent).toHaveBeenCalledWith({
      type: 'workflow.completed', source: 'durable-relay', workflowId: 'wf-1', workflowName: 'reviewOrder', taskQueue: '', status: 'completed',
    });
    expect(follower.size).toBe(0);
  });

  it('keeps checking while the workflow runs, then publishes', async () => {
    follower.follow('wf-2', 'reviewOrder');
    await vi.advanceTimersByTimeAsync(30);
    expect(publishWorkflowEvent).not.toHaveBeenCalled();
    provider.setState('wf-2', JOB_STATE.COMPLETED);
    await vi.advanceTimersByTimeAsync(40);
    expect(publishWorkflowEvent).toHaveBeenCalledTimes(1);
  });

  it('publishes workflow.failed for every unsuccessful close', async () => {
    for (const [id, state] of [['wf-f', JOB_STATE.FAILED], ['wf-t', JOB_STATE.TERMINATED]] as const) {
      provider.setState(id, state);
      follower.follow(id, 'reviewOrder');
      await vi.advanceTimersByTimeAsync(10);
      expect(publishWorkflowEvent).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'workflow.failed', workflowId: id, status: state }));
    }
  });

  it('gives up after the last delay while the workflow still runs', async () => {
    follower.follow('wf-3', 'reviewOrder');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(publishWorkflowEvent).not.toHaveBeenCalled();
    expect(follower.size).toBe(0);
  });

  it('publishes nothing for a workflow the engine does not know', async () => {
    provider.setState('wf-gone', JOB_STATE.UNKNOWN);
    follower.follow('wf-gone', 'reviewOrder');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(publishWorkflowEvent).not.toHaveBeenCalled();
  });

  it('follows a workflow once at a time and caps how many it follows', () => {
    follower.follow('a', 't');
    follower.follow('a', 't');
    follower.follow('b', 't');
    follower.follow('c', 't');
    expect(follower.size).toBe(2);
  });

  it('retries on the next delay when describe throws', async () => {
    const describe = vi.spyOn(provider, 'describe').mockRejectedValueOnce(new Error('engine down'));
    provider.setState('wf-4', JOB_STATE.COMPLETED);
    follower.follow('wf-4', 'reviewOrder');
    await vi.advanceTimersByTimeAsync(30);
    expect(describe).toHaveBeenCalledTimes(2);
    expect(publishWorkflowEvent).toHaveBeenCalledTimes(1);
  });

  it('stops every pending check', async () => {
    follower.follow('wf-5', 'reviewOrder');
    follower.stop();
    provider.setState('wf-5', JOB_STATE.COMPLETED);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(publishWorkflowEvent).not.toHaveBeenCalled();
    follower.follow('wf-6', 'reviewOrder');
    expect(follower.size).toBe(0);
  });
});
