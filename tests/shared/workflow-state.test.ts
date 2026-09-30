import { describe, it, expect } from 'vitest';

import { WORKFLOW_STATES, isTerminated, workflowStateFromStatus } from '../../shared/workflow-state';

describe('workflowStateFromStatus', () => {
  it('a positive status is running', () => {
    expect(workflowStateFromStatus(1)).toBe(WORKFLOW_STATES.RUNNING);
    expect(workflowStateFromStatus(7)).toBe(WORKFLOW_STATES.RUNNING);
  });

  it('a zero status is completed', () => {
    expect(workflowStateFromStatus(0)).toBe(WORKFLOW_STATES.COMPLETED);
  });

  it('a negative status is failed, including an interrupt', () => {
    expect(workflowStateFromStatus(-1)).toBe(WORKFLOW_STATES.FAILED);
    expect(workflowStateFromStatus(-1_000_000_001)).toBe(WORKFLOW_STATES.FAILED);
  });
});

describe('isTerminated', () => {
  it('only a negative status is terminated', () => {
    expect(isTerminated(-1_000_000_000)).toBe(true);
    expect(isTerminated(0)).toBe(false);
    expect(isTerminated(3)).toBe(false);
  });
});
