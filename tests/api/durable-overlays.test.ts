import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Execution, terminate and describe answer from the configured provider when
// HotMesh does not run the workflows.
vi.mock('../../services/escalation/crud', () => ({ cancelEscalationsByWorkflowId: vi.fn().mockResolvedValue(1) }));

import { exportWorkflowExecution } from '../../api/exports';
import { terminateWorkflow, describeWorkflow, getWorkflowResult } from '../../api/workflows';
import { getSettings } from '../../api/settings';
import { durableProviderRegistry } from '../../services/durable-provider';
import { cancelEscalationsByWorkflowId } from '../../services/escalation/crud';
import { FakeDurableProvider } from '../helpers/fake-durable-provider';

describe('engine-neutral workflow endpoints', () => {
  let provider: FakeDurableProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new FakeDurableProvider('temporal');
    durableProviderRegistry.register(provider, { consoleUrl: 'https://temporal.example/namespaces/{namespace}/workflows/{workflowId}' });
  });
  afterEach(() => durableProviderRegistry.clear());

  it('exports the execution from the provider', async () => {
    const result = await exportWorkflowExecution({ workflowId: 'wf-1' });
    expect(result.status).toBe(200);
    expect((result.data as any).workflow_type).toBe('fakeWorkflow');
  });

  it('answers 404 for a workflow the provider does not know', async () => {
    provider.setState('wf-gone', 'unknown');
    expect((await exportWorkflowExecution({ workflowId: 'wf-gone' })).status).toBe(404);
    expect((await describeWorkflow({ workflowId: 'wf-gone' })).status).toBe(404);
  });

  it('terminates through the provider and closes the escalations', async () => {
    const result = await terminateWorkflow({ workflowId: 'wf-2' });
    expect(result).toEqual({ status: 200, data: { terminated: true, workflowId: 'wf-2' } });
    expect(provider.terminated).toEqual(['wf-2']);
    expect(cancelEscalationsByWorkflowId).toHaveBeenCalledWith('wf-2');
  });

  it('describes through the provider', async () => {
    const result = await describeWorkflow({ workflowId: 'wf-3' });
    expect(result.status).toBe(200);
    expect(result.data).toMatchObject({ workflowId: 'wf-3', state: 'running' });
  });

  it('answers 202 for a result while the provider workflow runs', async () => {
    const result = await getWorkflowResult({ workflowId: 'wf-4' });
    expect(result).toEqual({ status: 202, data: { workflowId: 'wf-4', status: 'running' } });
  });

  it('reads a completed result from the provider execution', async () => {
    provider.setState('wf-5', 'completed');
    provider.result = { status: 'shipped' };
    const result = await getWorkflowResult({ workflowId: 'wf-5' });
    expect(result).toEqual({ status: 200, data: { workflowId: 'wf-5', state: 'completed', result: { status: 'shipped' } } });
  });

  it('reports a terminated provider workflow as failed', async () => {
    provider.setState('wf-6', 'terminated');
    const result = await getWorkflowResult({ workflowId: 'wf-6' });
    expect(result.data).toMatchObject({ state: 'failed', terminated: true, result: null });
  });

  it('reports the engine in settings and turns AI surfaces off', async () => {
    const result = await getSettings();
    const data = result.data as any;
    expect(data.engine).toEqual({
      provider: 'temporal',
      native: false,
      capabilities: { execution: true, terminate: true, list: true, start: true },
      consoleUrl: 'https://temporal.example/namespaces/{namespace}/workflows/{workflowId}',
    });
    expect(data.ai.enabled).toBe(false);
  });

  it('reports HotMesh as native when nothing is registered', async () => {
    durableProviderRegistry.clear();
    const data = (await getSettings()).data as any;
    expect(data.engine).toMatchObject({ provider: 'hotmesh', native: true, consoleUrl: null });
  });
});
