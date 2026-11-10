import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../services/workflow-invocation', async (importActual) => {
  const actual = await importActual<typeof import('../../../services/workflow-invocation')>();
  return { ...actual, invokeWorkflow: vi.fn() };
});

import { InvocationError, invokeWorkflow } from '../../../services/workflow-invocation';
import { ApiLineWorkflows } from '../../../services/machines/gateway/api-workflows';
import { NO_WORKFLOWS, START_OUTCOME, WorkflowStartRefused } from '../../../services/machines/gateway/workflows';

const invoke = vi.mocked(invokeWorkflow);
const workflows = new ApiLineWorkflows(() => 'controller-user');
const DATA = { rowId: 'r-1', ref: 'm-1' };

beforeEach(() => vi.clearAllMocks());

describe('ApiLineWorkflows', () => {
  it('starts the workflow under the given id, as the controller', async () => {
    invoke.mockResolvedValue({ workflowId: 'machine-request-r-1' });
    expect(await workflows.start('materialDesk', 'machine-request-r-1', DATA)).toBe(START_OUTCOME.STARTED);
    expect(invoke).toHaveBeenCalledWith({
      workflowType: 'materialDesk', data: DATA, options: { workflowId: 'machine-request-r-1' }, auth: { userId: 'controller-user' },
    });
  });

  it('a workflow already started under that id is found, not an error', async () => {
    invoke.mockRejectedValue(new Error('Duplicate job: machine-request-r-1'));
    expect(await workflows.start('materialDesk', 'machine-request-r-1', DATA)).toBe(START_OUTCOME.ALREADY);
  });

  it('an unknown or uninvocable workflow is refused for its configuration', async () => {
    invoke.mockRejectedValue(new InvocationError('Workflow not found (no config and no active worker)', 404));
    await expect(workflows.start('nope', 'machine-request-r-1', DATA)).rejects.toBeInstanceOf(WorkflowStartRefused);
    invoke.mockRejectedValue(new InvocationError('Workflow is not invocable', 403));
    await expect(workflows.start('nope', 'machine-request-r-1', DATA)).rejects.toThrow(/nope: Workflow is not invocable/);
  });

  it('any other failure is thrown as it is, so the start runs again', async () => {
    const down = new Error('connection terminated');
    invoke.mockRejectedValue(down);
    await expect(workflows.start('materialDesk', 'machine-request-r-1', DATA)).rejects.toBe(down);
  });

  it('a gateway with no starter refuses every start, naming the workflow', async () => {
    await expect(NO_WORKFLOWS.start('materialDesk', 'w', {})).rejects.toThrow(/materialDesk cannot start/);
  });
});
