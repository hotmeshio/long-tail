import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  useWorkflowListEvents,
  useWorkflowDetailEvents,
  useMcpQueryDetailEvents,
  useProcessDetailEvents,
  useEscalationStatsEvents,
  useEscalationListEvents,
  useEscalationDetailEvents,
  useProcessListEvents,
} from '../useEventHooks';

// ── Mock useEventSubscription (transport-agnostic) ──────────────────────────

type Handler = (event: any) => void;
const subscriptions: Array<{ pattern: string; handler: Handler }> = [];

vi.mock('../useEventContext', () => ({
  useEventSubscription: (pattern: string, handler: Handler) => {
    subscriptions.push({ pattern, handler });
  },
}));

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return {
    qc,
    Wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  };
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: 'task.completed',
    source: 'interceptor',
    workflowId: 'wf-123',
    workflowName: 'test',
    taskQueue: 'q',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  subscriptions.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── useWorkflowListEvents ────────────────────────────────────────────────────

describe('useWorkflowListEvents', () => {
  it('subscribes to task.> and workflow.> patterns', () => {
    const { Wrapper } = createWrapper();
    renderHook(() => useWorkflowListEvents(), { wrapper: Wrapper });

    const patterns = subscriptions.map((s) => s.pattern);
    expect(patterns).toContain('lt.events.task.>');
    expect(patterns).toContain('lt.events.workflow.>');
  });

  it('debounces and invalidates jobs query on task event', () => {
    const { qc, Wrapper } = createWrapper();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useWorkflowListEvents(), { wrapper: Wrapper });

    const taskSub = subscriptions.find((s) => s.pattern === 'lt.events.task.>');
    taskSub!.handler(makeEvent({ type: 'task.completed' }));

    expect(spy).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(350); });

    expect(spy).toHaveBeenCalledWith({ queryKey: ['jobs'] });
  });
});

// ── useWorkflowDetailEvents ──────────────────────────────────────────────────

describe('useWorkflowDetailEvents', () => {
  it('subscribes to lt.events.>', () => {
    const { Wrapper } = createWrapper();
    renderHook(() => useWorkflowDetailEvents('wf-123'), { wrapper: Wrapper });

    expect(subscriptions[0].pattern).toBe('lt.events.>');
  });

  it('invalidates workflow-specific keys via getInvalidationKeys on task event', () => {
    const { qc, Wrapper } = createWrapper();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useWorkflowDetailEvents('wf-123'), { wrapper: Wrapper });

    subscriptions[0].handler(makeEvent({ type: 'task.completed', workflowId: 'wf-123' }));

    act(() => { vi.advanceTimersByTime(450); });

    expect(spy).toHaveBeenCalledWith({ queryKey: ['workflowExecution', 'wf-123'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['workflowState', 'wf-123'] });
  });

  it('invalidates escalation queries for escalation events', () => {
    const { qc, Wrapper } = createWrapper();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useWorkflowDetailEvents('wf-123'), { wrapper: Wrapper });

    subscriptions[0].handler(makeEvent({ type: 'escalation.created', workflowId: 'wf-123' }));

    act(() => { vi.advanceTimersByTime(450); });

    expect(spy).toHaveBeenCalledWith({ queryKey: ['escalations', 'by-workflow', 'wf-123'] });
  });

  it('matches child workflowId containing parent orchestrator id', () => {
    const { qc, Wrapper } = createWrapper();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useWorkflowDetailEvents('myOrch-abc123'), { wrapper: Wrapper });

    subscriptions[0].handler(makeEvent({ workflowId: 'myTask-myOrch-abc123-2' }));

    act(() => { vi.advanceTimersByTime(450); });

    expect(spy).toHaveBeenCalled();
  });

  it('ignores events for a different workflowId', () => {
    const { qc, Wrapper } = createWrapper();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useWorkflowDetailEvents('wf-123'), { wrapper: Wrapper });

    subscriptions[0].handler(makeEvent({ workflowId: 'wf-other' }));

    act(() => { vi.advanceTimersByTime(450); });

    expect(spy).not.toHaveBeenCalled();
  });
});

// ── useMcpQueryDetailEvents ─────────────────────────────────────────────────

describe('useMcpQueryDetailEvents', () => {
  it('subscribes to lt.events.>', () => {
    const { Wrapper } = createWrapper();
    renderHook(() => useMcpQueryDetailEvents('wf-123'), { wrapper: Wrapper });

    expect(subscriptions[0].pattern).toBe('lt.events.>');
  });

  it('invalidates mcpQueryExecution and mcpQueryResult on workflow.completed', () => {
    const { qc, Wrapper } = createWrapper();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useMcpQueryDetailEvents('wf-123'), { wrapper: Wrapper });

    subscriptions[0].handler(makeEvent({ type: 'workflow.completed', workflowId: 'wf-123' }));

    act(() => { vi.advanceTimersByTime(450); });

    expect(spy).toHaveBeenCalledWith({ queryKey: ['mcpQueryExecution', 'wf-123'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['mcpQueryResult', 'wf-123'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['builderResult', 'wf-123'] });
  });

  it('invalidates mcpQueryExecution on task events', () => {
    const { qc, Wrapper } = createWrapper();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useMcpQueryDetailEvents('wf-123'), { wrapper: Wrapper });

    subscriptions[0].handler(makeEvent({ type: 'task.started', workflowId: 'wf-123' }));

    act(() => { vi.advanceTimersByTime(450); });

    expect(spy).toHaveBeenCalledWith({ queryKey: ['mcpQueryExecution', 'wf-123'] });
  });

  it('invalidates escalation keys for escalation events', () => {
    const { qc, Wrapper } = createWrapper();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useMcpQueryDetailEvents('wf-123'), { wrapper: Wrapper });

    subscriptions[0].handler(makeEvent({ type: 'escalation.created', workflowId: 'wf-123' }));

    act(() => { vi.advanceTimersByTime(450); });

    expect(spy).toHaveBeenCalledWith({ queryKey: ['escalations', 'by-workflow', 'wf-123'] });
  });

  it('ignores events for unrelated workflowId', () => {
    const { qc, Wrapper } = createWrapper();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useMcpQueryDetailEvents('wf-123'), { wrapper: Wrapper });

    subscriptions[0].handler(makeEvent({ workflowId: 'wf-other' }));

    act(() => { vi.advanceTimersByTime(450); });

    expect(spy).not.toHaveBeenCalled();
  });

  it('does nothing when workflowId is undefined', () => {
    const { qc, Wrapper } = createWrapper();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useMcpQueryDetailEvents(undefined), { wrapper: Wrapper });

    subscriptions[0].handler(makeEvent({ workflowId: 'wf-123' }));

    act(() => { vi.advanceTimersByTime(450); });

    expect(spy).not.toHaveBeenCalled();
  });
});

// ── useProcessDetailEvents ──────────────────────────────────────────────────

describe('useProcessDetailEvents', () => {
  it('subscribes to task.>, workflow.>, and escalation.> patterns', () => {
    const { Wrapper } = createWrapper();
    renderHook(() => useProcessDetailEvents('proc-1'), { wrapper: Wrapper });

    const patterns = subscriptions.map((s) => s.pattern);
    expect(patterns).toContain('lt.events.task.>');
    expect(patterns).toContain('lt.events.workflow.>');
    expect(patterns).toContain('lt.events.escalation.>');
  });

  it('invalidates process-specific key on matching originId', () => {
    const { qc, Wrapper } = createWrapper();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useProcessDetailEvents('proc-1'), { wrapper: Wrapper });

    const taskSub = subscriptions.find((s) => s.pattern === 'lt.events.task.>');
    taskSub!.handler(makeEvent({ type: 'task.completed', originId: 'proc-1' }));

    act(() => { vi.advanceTimersByTime(350); });

    expect(spy).toHaveBeenCalledWith({ queryKey: ['processes', 'proc-1'] });
  });

  it('ignores events with different originId', () => {
    const { qc, Wrapper } = createWrapper();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useProcessDetailEvents('proc-1'), { wrapper: Wrapper });

    const taskSub = subscriptions.find((s) => s.pattern === 'lt.events.task.>');
    taskSub!.handler(makeEvent({ type: 'task.completed', originId: 'proc-other' }));

    act(() => { vi.advanceTimersByTime(350); });

    expect(spy).not.toHaveBeenCalled();
  });
});

// ── useEscalationStatsEvents ─────────────────────────────────────────────────

describe('useEscalationStatsEvents', () => {
  it('subscribes to escalation.> pattern', () => {
    const { Wrapper } = createWrapper();
    renderHook(() => useEscalationStatsEvents(), { wrapper: Wrapper });

    expect(subscriptions[0].pattern).toBe('lt.events.escalation.>');
  });

  it('debounces and invalidates escalationStats query', () => {
    const { qc, Wrapper } = createWrapper();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useEscalationStatsEvents(), { wrapper: Wrapper });

    subscriptions[0].handler(makeEvent({ type: 'escalation.created' }));

    act(() => { vi.advanceTimersByTime(350); });

    expect(spy).toHaveBeenCalledWith({ queryKey: ['escalationStats'] });
  });
});

// ── useEscalationListEvents ──────────────────────────────────────────────────

describe('useEscalationListEvents', () => {
  it('subscribes to escalation.> pattern', () => {
    const { Wrapper } = createWrapper();
    renderHook(() => useEscalationListEvents(), { wrapper: Wrapper });

    expect(subscriptions[0].pattern).toBe('lt.events.escalation.>');
  });

  it('debounces and invalidates escalations query', () => {
    const { qc, Wrapper } = createWrapper();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useEscalationListEvents(), { wrapper: Wrapper });

    subscriptions[0].handler(makeEvent({ type: 'escalation.resolved' }));

    act(() => { vi.advanceTimersByTime(350); });

    expect(spy).toHaveBeenCalledWith({ queryKey: ['escalations'] });
  });
});

// ── useEscalationDetailEvents ─────────────────────────────────────────────────

describe('useEscalationDetailEvents', () => {
  it('invalidates detail + list + stats for matching escalationId', () => {
    const { qc, Wrapper } = createWrapper();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useEscalationDetailEvents('esc-1'), { wrapper: Wrapper });

    subscriptions[0].handler(makeEvent({ type: 'escalation.resolved', escalationId: 'esc-1' }));

    act(() => { vi.advanceTimersByTime(350); });

    expect(spy).toHaveBeenCalledWith({ queryKey: ['escalations', 'esc-1'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['escalations'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['escalationStats'] });
  });

  it('ignores events for a different escalationId', () => {
    const { qc, Wrapper } = createWrapper();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useEscalationDetailEvents('esc-1'), { wrapper: Wrapper });

    subscriptions[0].handler(makeEvent({ type: 'escalation.created', escalationId: 'esc-other' }));

    act(() => { vi.advanceTimersByTime(350); });

    expect(spy).not.toHaveBeenCalled();
  });
});

// ── useProcessListEvents ─────────────────────────────────────────────────────

describe('useProcessListEvents', () => {
  it('subscribes to task.> and workflow.> patterns', () => {
    const { Wrapper } = createWrapper();
    renderHook(() => useProcessListEvents(), { wrapper: Wrapper });

    const patterns = subscriptions.map((s) => s.pattern);
    expect(patterns).toContain('lt.events.task.>');
    expect(patterns).toContain('lt.events.workflow.>');
  });

  it('debounces and invalidates processes query on task event', () => {
    const { qc, Wrapper } = createWrapper();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useProcessListEvents(), { wrapper: Wrapper });

    const taskSub = subscriptions.find((s) => s.pattern === 'lt.events.task.>');
    taskSub!.handler(makeEvent({ type: 'task.started' }));

    act(() => { vi.advanceTimersByTime(350); });

    expect(spy).toHaveBeenCalledWith({ queryKey: ['processes'] });
  });
});
