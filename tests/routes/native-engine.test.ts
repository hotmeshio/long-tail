import { describe, it, expect, vi, afterEach } from 'vitest';

import { requireNativeEngine, nativeEngineError, WORKFLOW_NEUTRAL_ROUTES } from '../../routes/native-engine';
import { durableProviderRegistry } from '../../services/durable-provider';
import { FakeDurableProvider } from '../helpers/fake-durable-provider';

function invoke(handler: ReturnType<typeof requireNativeEngine>, method: string, path: string) {
  const next = vi.fn();
  const json = vi.fn();
  const res = { status: vi.fn().mockReturnValue({ json }) };
  handler({ method, path } as any, res as any, next);
  return { next, res, json };
}

describe('requireNativeEngine', () => {
  afterEach(() => durableProviderRegistry.clear());

  it('passes every route through on HotMesh', () => {
    const { next } = invoke(requireNativeEngine(), 'GET', '/anything');
    expect(next).toHaveBeenCalled();
  });

  it('answers 501 with the engine name on another provider', () => {
    durableProviderRegistry.register(new FakeDurableProvider('temporal'));
    const { next, res, json } = invoke(requireNativeEngine(), 'GET', '/jobs');
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(501);
    expect(json).toHaveBeenCalledWith({ error: nativeEngineError() });
    expect(nativeEngineError()).toMatch(/runs temporal/);
  });

  it('lets listed engine-neutral routes through', () => {
    durableProviderRegistry.register(new FakeDurableProvider('dbos'));
    const gate = requireNativeEngine([{ method: 'GET', path: /^\/[^/]+\/execution$/ }]);
    expect(invoke(gate, 'GET', '/wf-1/execution').next).toHaveBeenCalled();
    expect(invoke(gate, 'POST', '/wf-1/execution').next).not.toHaveBeenCalled();
    expect(invoke(gate, 'GET', '/wf-1/state').next).not.toHaveBeenCalled();
  });

  it('serves workflow configs, invoke and schedules on every engine', () => {
    durableProviderRegistry.register(new FakeDurableProvider('dbos'));
    const gate = requireNativeEngine(WORKFLOW_NEUTRAL_ROUTES);
    for (const [method, path] of [
      ['GET', '/config'],
      ['PUT', '/reviewOrder/config'],
      ['DELETE', '/reviewOrder/config'],
      ['GET', '/invocable'],
      ['GET', '/discovered'],
      ['POST', '/reviewOrder/invoke'],
      ['GET', '/wf-1/result'],
      ['GET', '/cron/status'],
    ]) {
      expect(invoke(gate, method, path).next, `${method} ${path}`).toHaveBeenCalled();
    }
    expect(invoke(gate, 'GET', '/workers').next).not.toHaveBeenCalled();
  });
});
