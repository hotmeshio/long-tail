import { describe, it, expect, vi, beforeEach } from 'vitest';

// Reads by workflow and by process return only the escalations the caller
// may read; in-process callers that pass no identity read every row.
const mocks = vi.hoisted(() => ({
  byWorkflow: vi.fn(),
  byOrigin: vi.fn(),
  processTasks: vi.fn(async () => [{ id: 't1' }]),
  scope: vi.fn(),
}));
vi.mock('../../services/escalation', () => ({
  getEscalationsByWorkflowId: mocks.byWorkflow,
  getEscalationsByOriginId: mocks.byOrigin,
}));
vi.mock('../../services/task', () => ({ getProcessTasks: mocks.processTasks }));
vi.mock('../../services/role', () => ({}));
vi.mock('../../api/escalations/helpers', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  getEscalationReadScope: mocks.scope,
}));

import { getEscalationsByWorkflowId } from '../../api/escalations/single';
import { getProcess } from '../../api/tasks';
import { scopeAdmits } from '../../api/escalations/helpers';

const ME = '11111111-1111-4111-8111-111111111111';
const ROWS = [
  { id: 'a', role: 'fleet', assigned_to: null },
  { id: 'b', role: 'payroll', assigned_to: null },
  { id: 'c', role: 'bins', assigned_to: ME },
  { id: 'd', role: 'bins', assigned_to: 'someone-else' },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.byWorkflow.mockResolvedValue(ROWS);
  mocks.byOrigin.mockResolvedValue(ROWS);
  mocks.scope.mockResolvedValue({ global: false, allRoles: ['fleet'], selfRoles: ['bins'] });
});

describe('scopeAdmits', () => {
  it('global reads every row; otherwise all-scope roles, and self-scope rows assigned to me', () => {
    const scope = { global: false, allRoles: ['fleet'], selfRoles: ['bins'] };
    expect(ROWS.filter((r) => scopeAdmits(scope, ME, r)).map((r) => r.id)).toEqual(['a', 'c']);
    expect(ROWS.every((r) => scopeAdmits({ global: true, allRoles: [], selfRoles: [] }, ME, r))).toBe(true);
  });
});

describe('getEscalationsByWorkflowId', () => {
  it('with a caller, only the rows the caller may read', async () => {
    const result = await getEscalationsByWorkflowId({ workflowId: 'wf' }, { userId: ME });
    expect(result.data.escalations.map((e: any) => e.id)).toEqual(['a', 'c']);
  });

  it('without a caller (in-process SDK), every row, with no scope lookup', async () => {
    const result = await getEscalationsByWorkflowId({ workflowId: 'wf' });
    expect(result.data.escalations).toHaveLength(4);
    expect(mocks.scope).not.toHaveBeenCalled();
  });
});

describe('getProcess', () => {
  it('scopes the escalations to the caller and keeps the tasks', async () => {
    const result = await getProcess({ originId: 'o1' }, { userId: ME });
    expect(result.data.escalations.map((e: any) => e.id)).toEqual(['a', 'c']);
    expect(result.data.tasks).toEqual([{ id: 't1' }]);
  });

  it('without a caller, every escalation', async () => {
    expect((await getProcess({ originId: 'o1' })).data.escalations).toHaveLength(4);
  });
});
