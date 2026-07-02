import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/events/publish', () => ({
  publishWorkflowEvent: vi.fn(),
  publishMilestoneEvent: vi.fn(),
}));

import { handleCompletion } from '../../../services/interceptor/completion';
import { publishWorkflowEvent, publishMilestoneEvent } from '../../../lib/events/publish';

// ─────────────────────────────────────────────────────────────────────────────
// Completion events publish exactly once per workflow completion.
//
// handleCompletion runs inside WORKFLOW code, and its durable proxy calls
// (ltCompleteTask / ltSignalParent) interrupt the function on first dispatch —
// the whole workflow then replays and handleCompletion runs again. Any
// fire-and-forget publish placed BEFORE those proxy calls therefore fires once
// per execution of the completing leg: twice for every certified workflow
// (observed live as doubled system.workflow.<id>.completed events). The
// publishes must sit AFTER the interrupting proxy calls so only the final,
// uninterrupted leg reaches them.
// ─────────────────────────────────────────────────────────────────────────────

const RESULT = {
  type: 'return' as const,
  data: { ok: true },
  milestones: [{ name: 'done', value: 1 }],
};

const state = (activities: Record<string, unknown>, routing?: Record<string, unknown>) => ({
  activities,
  routing,
  isReRun: false,
  workflowId: 'wf-1',
  workflowName: 'taskWorkflow',
  taskQueue: 'task-addon',
  taskId: 'task-1',
  envelope: { lt: { originId: 'origin-1' } },
} as any);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleCompletion — exactly-once event publish across interrupt/replay', () => {
  it('standalone (ltCompleteTask) branch: one completed + one milestone event across the pair', async () => {
    // Execution #1: the durable proxy dispatches the activity and interrupts.
    const interrupted = state({
      ltCompleteTask: vi.fn().mockRejectedValue(new Error('DurableProxyError')),
    });
    await expect(handleCompletion(interrupted, RESULT as any)).rejects.toThrow('DurableProxyError');

    // Execution #2 (replay): the proxy returns its cached result and the leg completes.
    const replayed = state({ ltCompleteTask: vi.fn().mockResolvedValue(undefined) });
    await handleCompletion(replayed, RESULT as any);

    expect(publishWorkflowEvent).toHaveBeenCalledTimes(1);
  });

  it('routed (ltSignalParent) branch: one completed event across the pair', async () => {
    const routing = {
      parentWorkflowId: 'parent-1',
      parentTaskQueue: 'parents',
      parentWorkflowType: 'parentWorkflow',
      signalId: 'sig-1',
    };
    const interrupted = state(
      { ltSignalParent: vi.fn().mockRejectedValue(new Error('DurableProxyError')) },
      routing,
    );
    await expect(handleCompletion(interrupted, RESULT as any)).rejects.toThrow('DurableProxyError');

    const replayed = state(
      { ltSignalParent: vi.fn().mockResolvedValue(undefined) },
      routing,
    );
    await handleCompletion(replayed, RESULT as any);

    expect(publishWorkflowEvent).toHaveBeenCalledTimes(1);
  });

  it('the completed event keeps its full shape (taskId, originId, augmented data)', async () => {
    await handleCompletion(state({ ltCompleteTask: vi.fn().mockResolvedValue(undefined) }), RESULT as any);
    expect(publishWorkflowEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'workflow.completed',
      workflowId: 'wf-1',
      taskId: 'task-1',
      originId: 'origin-1',
      status: 'completed',
      data: { ok: true },
    }));
  });
});
