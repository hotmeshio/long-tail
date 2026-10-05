import { describe, it, expect, vi, beforeEach } from 'vitest';

// Task rows carry a run's input (envelope), output (data) and metadata. A
// builder, and the person who started the run or it runs as, see them; any
// other caller sees the row without them. In-process calls see whole rows.

const mocks = vi.hoisted(() => ({
  listTasks: vi.fn(),
  getTask: vi.fn(),
  getProcessTasks: vi.fn(),
  mayBuild: vi.fn(),
}));
vi.mock('../../services/task', () => ({
  listTasks: mocks.listTasks,
  getTask: mocks.getTask,
  getProcessTasks: mocks.getProcessTasks,
}));
vi.mock('../../services/escalation', () => ({ getEscalationsByOriginId: vi.fn(async () => []) }));
vi.mock('../../api/escalations/helpers', () => ({
  getEscalationReadScope: vi.fn(async () => ({ global: true, allRoles: [], selfRoles: [] })),
  scopeAdmits: () => true,
}));
vi.mock('../../modules/capabilities', () => ({ mayBuild: mocks.mayBuild }));

import { listTasks, getTask, getProcess } from '../../api/tasks';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const task = (id: string, initiated_by: string | null, executing_as: string | null = null) => ({
  id, initiated_by, executing_as, status: 'completed', milestones: [],
  envelope: '{"data":{"secret":1}}', data: '{"out":1}', metadata: { k: 'v' },
});
const RUN_DATA = ['envelope', 'data', 'metadata'];
const hasRunData = (t: Record<string, unknown>) => RUN_DATA.every((k) => k in t);
const hasNone = (t: Record<string, unknown>) => RUN_DATA.every((k) => !(k in t));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listTasks.mockResolvedValue({ tasks: [task('mine', ME), task('as-me', OTHER, ME), task('theirs', OTHER)], total: 3 });
  mocks.getProcessTasks.mockResolvedValue([task('mine', ME), task('theirs', OTHER)]);
  mocks.getTask.mockResolvedValue(task('theirs', OTHER));
});

describe('task run data', () => {
  it('a non-builder sees run data only on runs they started or run as', async () => {
    mocks.mayBuild.mockResolvedValue(false);
    const { data } = await listTasks({}, { userId: ME });
    const [mine, asMe, theirs] = data.tasks;
    expect(hasRunData(mine)).toBe(true);
    expect(hasRunData(asMe)).toBe(true);
    expect(hasNone(theirs)).toBe(true);
    expect(theirs).toMatchObject({ id: 'theirs', status: 'completed', milestones: [] });
    expect(data.total).toBe(3);
  });

  it('applies to the process detail and a single task', async () => {
    mocks.mayBuild.mockResolvedValue(false);
    const process = await getProcess({ originId: 'o-1' }, { userId: ME });
    expect(process.data.tasks.map(hasRunData)).toEqual([true, false]);
    const single = await getTask({ id: 'theirs' }, { userId: ME });
    expect(hasNone(single.data)).toBe(true);
  });

  it('a builder sees every row whole', async () => {
    mocks.mayBuild.mockResolvedValue(true);
    const { data } = await listTasks({}, { userId: OTHER });
    expect(data.tasks.every(hasRunData)).toBe(true);
  });

  it('an in-process call (no auth) sees whole rows and checks nothing', async () => {
    const { data } = await listTasks({});
    expect(data.tasks.every(hasRunData)).toBe(true);
    expect(mocks.mayBuild).not.toHaveBeenCalled();
  });
});
