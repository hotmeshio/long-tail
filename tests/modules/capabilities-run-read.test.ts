import { describe, it, expect, vi, beforeEach } from 'vitest';

// mayReadWorkflowRun reads the run's own start envelope: a builder, the
// identity the run runs as (lt.userId), or the person who started it under
// execute_as (lt.initiatedBy). No task record is consulted.

const mocks = vi.hoisted(() => ({
  startIdentity: vi.fn(),
  isSuperAdmin: vi.fn(async () => false),
  hasRole: vi.fn(async () => false),
}));
vi.mock('../../services/export', () => ({ getWorkflowStartIdentity: mocks.startIdentity }));
vi.mock('../../services/user', async (io) => ({ ...(await io<typeof import('../../services/user')>()), isSuperAdmin: mocks.isSuperAdmin }));
vi.mock('../../services/user/roles', async (io) => ({ ...(await io<typeof import('../../services/user/roles')>()), hasRole: mocks.hasRole }));

import { mayReadWorkflowRun } from '../../modules/capabilities';

const ME = '11111111-1111-4111-8111-111111111111';
const BOT = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isSuperAdmin.mockResolvedValue(false);
  mocks.hasRole.mockResolvedValue(false);
});

describe('mayReadWorkflowRun', () => {
  it('admits the identity the run runs as', async () => {
    mocks.startIdentity.mockResolvedValue({ userId: ME });
    expect(await mayReadWorkflowRun({ userId: ME }, 'wf-1')).toBe(true);
  });

  it('admits the person who started it under execute_as, and the bot it runs as', async () => {
    mocks.startIdentity.mockResolvedValue({ userId: BOT, initiatedBy: ME });
    expect(await mayReadWorkflowRun({ userId: ME }, 'wf-1')).toBe(true);
    expect(await mayReadWorkflowRun({ userId: BOT }, 'wf-1')).toBe(true);
  });

  it('refuses anyone else, and a run that cannot be found', async () => {
    mocks.startIdentity.mockResolvedValue({ userId: BOT });
    expect(await mayReadWorkflowRun({ userId: ME }, 'wf-1')).toBe(false);
    mocks.startIdentity.mockResolvedValue(null);
    expect(await mayReadWorkflowRun({ userId: ME }, 'wf-2')).toBe(false);
  });

  it('a builder reads any run without reading the envelope', async () => {
    mocks.isSuperAdmin.mockResolvedValue(true);
    expect(await mayReadWorkflowRun({ userId: ME }, 'wf-1')).toBe(true);
    expect(mocks.startIdentity).not.toHaveBeenCalled();
  });
});
