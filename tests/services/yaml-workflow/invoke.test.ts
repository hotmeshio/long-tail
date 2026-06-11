import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────
const { publishMock, asyncInvokeMock, syncInvokeMock, getEngineMock } = vi.hoisted(() => ({
  publishMock: vi.fn().mockResolvedValue(undefined),
  asyncInvokeMock: vi.fn().mockResolvedValue('job-async-1'),
  syncInvokeMock: vi.fn().mockResolvedValue({ job_id: 'job-sync-1', result: { data: { greeting: 'hi' } } }),
  getEngineMock: vi.fn(),
}));

vi.mock('../../../lib/events/publish', () => ({
  publishWorkflowEvent: publishMock,
}));

vi.mock('../../../services/yaml-workflow/deployer', () => ({
  invokeYamlWorkflow: asyncInvokeMock,
  invokeYamlWorkflowSync: syncInvokeMock,
  getEngine: getEngineMock,
}));

vi.mock('../../../services/iam/principal', () => ({
  resolvePrincipal: vi.fn().mockResolvedValue(null),
}));

import { invokeYamlWorkflow } from '../../../services/yaml-workflow/invoke';

const wf = {
  app_id: 'graph',
  graph_topic: 'hello_world',
  execute_as: null,
} as any;

// Minimal internal engine stub — no ngn so we don't register callbacks
const stubEngine = () => {
  getEngineMock.mockResolvedValue({ engine: { guid: undefined } });
};

describe('invokeYamlWorkflow — lifecycle events', () => {
  beforeEach(() => {
    publishMock.mockClear();
    asyncInvokeMock.mockClear();
    syncInvokeMock.mockClear();
    getEngineMock.mockClear();
    stubEngine();
  });

  it('emits workflow.started on async invocation', async () => {
    await invokeYamlWorkflow(wf, {});

    const started = publishMock.mock.calls.find(([e]) => e.type === 'workflow.started');
    expect(started).toBeDefined();
    expect(started![0]).toMatchObject({
      type: 'workflow.started',
      source: 'graph',
      workflowName: 'hello_world',
      taskQueue: 'graph',
      status: 'running',
    });
  });

  it('sets workflowId to the returned jobId on async invocation', async () => {
    asyncInvokeMock.mockResolvedValue('job-abc');
    await invokeYamlWorkflow(wf, {});

    const started = publishMock.mock.calls.find(([e]) => e.type === 'workflow.started');
    expect(started![0].workflowId).toBe('job-abc');
  });

  it('emits workflow.started on sync invocation', async () => {
    await invokeYamlWorkflow(wf, { sync: true });

    const started = publishMock.mock.calls.find(([e]) => e.type === 'workflow.started');
    expect(started).toBeDefined();
    expect(started![0].source).toBe('graph');
  });

  it('emits workflow.completed after successful sync invocation', async () => {
    syncInvokeMock.mockResolvedValue({ job_id: 'job-1', result: { data: { ok: true } } });
    await invokeYamlWorkflow(wf, { sync: true });

    const completed = publishMock.mock.calls.find(([e]) => e.type === 'workflow.completed');
    expect(completed).toBeDefined();
    expect(completed![0]).toMatchObject({
      type: 'workflow.completed',
      source: 'graph',
      workflowId: 'job-1',
      status: 'completed',
    });
  });

  it('emits workflow.failed and rethrows when sync invocation throws', async () => {
    syncInvokeMock.mockRejectedValue(new Error('timeout'));
    await expect(invokeYamlWorkflow(wf, { sync: true })).rejects.toThrow('timeout');

    const failed = publishMock.mock.calls.find(([e]) => e.type === 'workflow.failed');
    expect(failed).toBeDefined();
    expect(failed![0]).toMatchObject({
      type: 'workflow.failed',
      source: 'graph',
      status: 'failed',
    });
  });

  it('registers a completion callback when the engine exposes ngn', async () => {
    const registerMock = vi.fn();
    getEngineMock.mockResolvedValue({
      engine: {
        guid: 'engine-1',
        registerJobCallback: registerMock,
        delistJobCallback: vi.fn(),
      },
    });

    await invokeYamlWorkflow(wf, {});

    expect(registerMock).toHaveBeenCalledOnce();
  });

  it('does not register a callback when engine lacks guid', async () => {
    // stubEngine() already sets guid: undefined
    const registerMock = vi.fn();
    getEngineMock.mockResolvedValue({ engine: { guid: undefined, registerJobCallback: registerMock } });

    await invokeYamlWorkflow(wf, {});

    expect(registerMock).not.toHaveBeenCalled();
  });
});
