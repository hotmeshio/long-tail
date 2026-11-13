import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

let settings: { data: unknown } = { data: undefined };
vi.mock('../../api/settings', () => ({ useSettings: () => settings }));

import { useEngine, engineConsoleUrl, engineListsExecutions, engineStartsWorkflows } from '../useEngine';

const TEMPORAL = {
  provider: 'temporal',
  native: false,
  capabilities: { execution: true, terminate: true },
  consoleUrl: 'https://ui.example/namespaces/{namespace}/workflows/{workflowId}',
};

describe('useEngine', () => {
  it('is HotMesh before settings load', () => {
    settings = { data: undefined };
    const { result } = renderHook(() => useEngine());
    expect(result.current.native).toBe(true);
    expect(result.current.provider).toBe('hotmesh');
  });

  it('is HotMesh when the server predates the engine field', () => {
    settings = { data: {} };
    const { result } = renderHook(() => useEngine());
    expect(result.current.native).toBe(true);
    expect(result.current.capabilities.execution).toBe(true);
  });

  it('reports the configured engine', () => {
    settings = { data: { engine: TEMPORAL } };
    const { result } = renderHook(() => useEngine());
    expect(result.current).toEqual(TEMPORAL);
  });
});

describe('engineConsoleUrl', () => {
  it('fills the workflow id, encoded', () => {
    expect(engineConsoleUrl(TEMPORAL, 'order/1 a')).toBe(
      'https://ui.example/namespaces/{namespace}/workflows/order%2F1%20a',
    );
  });

  it('is null without a template', () => {
    expect(engineConsoleUrl({ ...TEMPORAL, consoleUrl: null }, 'wf-1')).toBeNull();
  });
});

describe('engineListsExecutions', () => {
  it('is true on HotMesh and on a provider that lists', () => {
    expect(engineListsExecutions({ ...TEMPORAL, native: true })).toBe(true);
    expect(engineListsExecutions({ ...TEMPORAL, capabilities: { ...TEMPORAL.capabilities, list: true } })).toBe(true);
  });

  it('is false on a provider without list, including servers that predate the flag', () => {
    expect(engineListsExecutions(TEMPORAL)).toBe(false);
    expect(engineListsExecutions({ ...TEMPORAL, capabilities: { ...TEMPORAL.capabilities, list: false } })).toBe(false);
  });
});

describe('engineStartsWorkflows', () => {
  it('is true on HotMesh and on a provider that starts workflows', () => {
    expect(engineStartsWorkflows({ ...TEMPORAL, native: true })).toBe(true);
    expect(engineStartsWorkflows({ ...TEMPORAL, capabilities: { ...TEMPORAL.capabilities, start: true } })).toBe(true);
  });

  it('is false on a provider without start, including servers that predate the flag', () => {
    expect(engineStartsWorkflows(TEMPORAL)).toBe(false);
    expect(engineStartsWorkflows({ ...TEMPORAL, capabilities: { ...TEMPORAL.capabilities, start: false } })).toBe(false);
  });
});
