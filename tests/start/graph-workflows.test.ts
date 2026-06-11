import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────
const { createMock, deployMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  deployMock: vi.fn(),
}));

vi.mock('../../api/yaml-workflows/crud', () => ({
  createYamlWorkflowDirect: createMock,
}));

vi.mock('../../api/yaml-workflows/deploy', () => ({
  deployYamlWorkflow: deployMock,
}));

vi.mock('../../lib/logger', () => ({
  loggerRegistry: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { seedGraphWorkflows } from '../../start/graph-workflows';

const flow = { name: 'hello_world', yaml: 'app: {}' };

describe('seedGraphWorkflows', () => {
  beforeEach(() => {
    createMock.mockReset();
    deployMock.mockReset();
  });

  it('creates then deploys a new flow', async () => {
    createMock.mockResolvedValue({ status: 200, data: { id: 'wf-1' } });
    deployMock.mockResolvedValue({ status: 200, data: { id: 'wf-1' } });

    await seedGraphWorkflows([flow]);

    expect(createMock).toHaveBeenCalledOnce();
    expect(deployMock).toHaveBeenCalledWith({ id: 'wf-1' });
  });

  it('defaults the namespace to "graph"', async () => {
    createMock.mockResolvedValue({ status: 200, data: { id: 'wf-1' } });
    deployMock.mockResolvedValue({ status: 200 });

    await seedGraphWorkflows([flow]);

    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ app_id: 'graph' }));
  });

  it('skips deploy when the flow already exists (409)', async () => {
    createMock.mockResolvedValue({ status: 409, error: 'topic exists' });

    await seedGraphWorkflows([flow]);

    expect(deployMock).not.toHaveBeenCalled();
  });

  it('skips deploy when create fails', async () => {
    createMock.mockResolvedValue({ status: 500, error: 'boom' });

    await seedGraphWorkflows([flow]);

    expect(deployMock).not.toHaveBeenCalled();
  });

  it('does not throw when a flow errors — one bad flow never blocks boot', async () => {
    createMock.mockRejectedValueOnce(new Error('kaboom'));
    createMock.mockResolvedValueOnce({ status: 200, data: { id: 'wf-2' } });
    deployMock.mockResolvedValue({ status: 200 });

    await expect(
      seedGraphWorkflows([flow, { name: 'second', yaml: 'app: {}' }]),
    ).resolves.toBeUndefined();
    // Second flow still processed after the first threw.
    expect(deployMock).toHaveBeenCalledWith({ id: 'wf-2' });
  });
});
