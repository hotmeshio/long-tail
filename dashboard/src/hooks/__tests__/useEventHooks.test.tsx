import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { REALTIME_REFRESH } from '../../lib/realtime-refresh';
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
  useEventSubscriptions: (patterns: string[], handler: Handler) => {
    for (const pattern of patterns) subscriptions.push({ pattern, handler });
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

// Advance past a tier's coalesce window — tests tune with the knobs.
const DETAIL_FLUSH_MS = REALTIME_REFRESH.DETAIL.coalesceMs + 50;
const LIST_FLUSH_MS = REALTIME_REFRESH.LIST.coalesceMs + 50;
const SUMMARY_FLUSH_MS = REALTIME_REFRESH.SUMMARY.coalesceMs + 50;

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: 'system.task.tsk-001.completed',
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
    expect(patterns).toContain('lt.events.system.task.>');
    expect(patterns).toContain('lt.events.system.workflow.>');
  });

  it('debounces and invalidates jobs query on task event', () => {
    const { qc, Wrapper } = createWrapper();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useWorkflowListEvents(), { wrapper: Wrapper });

    const taskSub = subscriptions.find((s) => s.pattern === 'lt.events.system.task.>');
    taskSub!.handler(makeEvent({ type: 'system.task.tsk-001.completed' }));

    expect(spy).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(LIST_FLUSH_MS); });

    expect(spy).toHaveBeenCalledWith({ queryKey: ['jobs'] });
  });
});

// ── useWorkflowDetailEvents ──────────────────────────────────────────────────

describe('useWorkflowDetailEvents', () => {
  it('subscribes to the workflow-detail subject families, never the firehose', () => {
    const { Wrapper } = createWrapper();
    renderHook(() => useWorkflowDetailEvents('wf-123'), { wrapper: Wrapper });

    const patterns = subscriptions.map((s) => s.pattern);
    expect(patterns).toContain('lt.events.system.workflow.>');
    expect(patterns).toContain('lt.events.system.activity.>');
    expect(patterns).toContain('lt.events.system.milestone.>');
    expect(patterns).toContain('lt.events.system.task.>');
    expect(patterns).toContain('lt.events.system.escalation.>');
    expect(patterns).not.toContain('lt.events.>');
  });

  it('invalidates workflow-specific keys via getInvalidationKeys on task event', () => {
    const { qc, Wrapper } = createWrapper();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useWorkflowDetailEvents('wf-123'), { wrapper: Wrapper });

    subscriptions[0].handler(makeEvent({ type: 'system.task.tsk-001.completed', workflowId: 'wf-123' }));

    act(() => { vi.advanceTimersByTime(DETAIL_FLUSH_MS); });

    expect(spy).toHaveBeenCalledWith({ queryKey: ['workflowExecution', 'wf-123'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['workflowState', 'wf-123'] });
  });

  it('invalidates escalation queries for escalation events', () => {
    const { qc, Wrapper } = createWrapper();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useWorkflowDetailEvents('wf-123'), { wrapper: Wrapper });

    subscriptions[0].handler(makeEvent({ type: 'system.escalation.order-review.esc-001.created', workflowId: 'wf-123' }));

    act(() => { vi.advanceTimersByTime(DETAIL_FLUSH_MS); });

    expect(spy).toHaveBeenCalledWith({ queryKey: ['escalations', 'by-workflow', 'wf-123'] });
  });

  it('matches child workflowId containing parent orchestrator id', () => {
    const { qc, Wrapper } = createWrapper();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useWorkflowDetailEvents('myOrch-abc123'), { wrapper: Wrapper });

    subscriptions[0].handler(makeEvent({ workflowId: 'myTask-myOrch-abc123-2' }));

    act(() => { vi.advanceTimersByTime(DETAIL_FLUSH_MS); });

    expect(spy).toHaveBeenCalled();
  });

  it('ignores events for a different workflowId', () => {
    const { qc, Wrapper } = createWrapper();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useWorkflowDetailEvents('wf-123'), { wrapper: Wrapper });

    subscriptions[0].handler(makeEvent({ workflowId: 'wf-other' }));

    act(() => { vi.advanceTimersByTime(DETAIL_FLUSH_MS); });

    expect(spy).not.toHaveBeenCalled();
  });
});

// ── useMcpQueryDetailEvents ─────────────────────────────────────────────────

describe('useMcpQueryDetailEvents', () => {
  it('subscribes to the workflow-detail subject families, never the firehose', () => {
    const { Wrapper } = createWrapper();
    renderHook(() => useMcpQueryDetailEvents('wf-123'), { wrapper: Wrapper });

    const patterns = subscriptions.map((s) => s.pattern);
    expect(patterns).toContain('lt.events.system.workflow.>');
    expect(patterns).toContain('lt.events.system.escalation.>');
    expect(patterns).not.toContain('lt.events.>');
  });

  it('invalidates mcpQueryExecution and mcpQueryResult on workflow.completed', () => {
    const { qc, Wrapper } = createWrapper();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useMcpQueryDetailEvents('wf-123'), { wrapper: Wrapper });

    subscriptions[0].handler(makeEvent({ type: 'system.workflow.wf-123.completed', workflowId: 'wf-123' }));

    act(() => { vi.advanceTimersByTime(DETAIL_FLUSH_MS); });

    expect(spy).toHaveBeenCalledWith({ queryKey: ['mcpQueryExecution', 'wf-123'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['mcpQueryResult', 'wf-123'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['builderResult', 'wf-123'] });
  });

  it('invalidates mcpQueryExecution on task events', () => {
    const { qc, Wrapper } = createWrapper();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useMcpQueryDetailEvents('wf-123'), { wrapper: Wrapper });

    subscriptions[0].handler(makeEvent({ type: 'system.task.tsk-001.started', workflowId: 'wf-123' }));

    act(() => { vi.advanceTimersByTime(DETAIL_FLUSH_MS); });

    expect(spy).toHaveBeenCalledWith({ queryKey: ['mcpQueryExecution', 'wf-123'] });
  });

  it('invalidates escalation keys for escalation events', () => {
    const { qc, Wrapper } = createWrapper();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useMcpQueryDetailEvents('wf-123'), { wrapper: Wrapper });

    subscriptions[0].handler(makeEvent({ type: 'system.escalation.order-review.esc-001.created', workflowId: 'wf-123' }));

    act(() => { vi.advanceTimersByTime(DETAIL_FLUSH_MS); });

    expect(spy).toHaveBeenCalledWith({ queryKey: ['escalations', 'by-workflow', 'wf-123'] });
  });

  it('ignores events for unrelated workflowId', () => {
    const { qc, Wrapper } = createWrapper();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useMcpQueryDetailEvents('wf-123'), { wrapper: Wrapper });

    subscriptions[0].handler(makeEvent({ workflowId: 'wf-other' }));

    act(() => { vi.advanceTimersByTime(DETAIL_FLUSH_MS); });

    expect(spy).not.toHaveBeenCalled();
  });

  it('holds no subscriptions when workflowId is undefined', () => {
    const { Wrapper } = createWrapper();
    renderHook(() => useMcpQueryDetailEvents(undefined), { wrapper: Wrapper });

    expect(subscriptions).toHaveLength(0);
  });
});

// ── useProcessDetailEvents ──────────────────────────────────────────────────

describe('useProcessDetailEvents', () => {
  it('subscribes to task.>, workflow.>, and escalation.> patterns', () => {
    const { Wrapper } = createWrapper();
    renderHook(() => useProcessDetailEvents('proc-1'), { wrapper: Wrapper });

    const patterns = subscriptions.map((s) => s.pattern);
    expect(patterns).toContain('lt.events.system.task.>');
    expect(patterns).toContain('lt.events.system.workflow.>');
    expect(patterns).toContain('lt.events.system.escalation.>');
  });

  it('invalidates process-specific key on matching originId', () => {
    const { qc, Wrapper } = createWrapper();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useProcessDetailEvents('proc-1'), { wrapper: Wrapper });

    const taskSub = subscriptions.find((s) => s.pattern === 'lt.events.system.task.>');
    taskSub!.handler(makeEvent({ type: 'system.task.tsk-001.completed', originId: 'proc-1' }));

    act(() => { vi.advanceTimersByTime(DETAIL_FLUSH_MS); });

    expect(spy).toHaveBeenCalledWith({ queryKey: ['processes', 'proc-1'] });
  });

  it('ignores events with different originId', () => {
    const { qc, Wrapper } = createWrapper();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useProcessDetailEvents('proc-1'), { wrapper: Wrapper });

    const taskSub = subscriptions.find((s) => s.pattern === 'lt.events.system.task.>');
    taskSub!.handler(makeEvent({ type: 'system.task.tsk-001.completed', originId: 'proc-other' }));

    act(() => { vi.advanceTimersByTime(DETAIL_FLUSH_MS); });

    expect(spy).not.toHaveBeenCalled();
  });
});

// ── useEscalationStatsEvents ─────────────────────────────────────────────────

describe('useEscalationStatsEvents', () => {
  it('subscribes to the escalation family (all roles, all verbs)', () => {
    const { Wrapper } = createWrapper();
    renderHook(() => useEscalationStatsEvents(), { wrapper: Wrapper });

    expect(subscriptions[0].pattern).toBe('lt.events.system.escalation.*.*.>');
  });

  it('debounces and invalidates escalationStats query', () => {
    const { qc, Wrapper } = createWrapper();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useEscalationStatsEvents(), { wrapper: Wrapper });

    subscriptions[0].handler(makeEvent({ type: 'system.escalation.order-review.esc-001.created' }));

    act(() => { vi.advanceTimersByTime(SUMMARY_FLUSH_MS); });

    expect(spy).toHaveBeenCalledWith({ queryKey: ['escalationStats'] });
  });

  it("bounds a constant event stream to the tier's refractory rate — never starves, never exceeds", () => {
    const { qc, Wrapper } = createWrapper();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useEscalationStatsEvents(), { wrapper: Wrapper });

    // Sustained stream spanning the coalesce window plus two full refractory
    // intervals: exactly three flushes — the coalesced first, then one per
    // cooldown boundary (the trailing flush is what prevents starvation).
    const { coalesceMs, minIntervalMs } = REALTIME_REFRESH.SUMMARY;
    const totalMs = coalesceMs + 2 * minIntervalMs;
    act(() => {
      for (let elapsed = 0; elapsed < totalMs; elapsed += 100) {
        subscriptions[0].handler(makeEvent({ type: `system.escalation.qa.esc-${elapsed}.claimed` }));
        vi.advanceTimersByTime(100);
      }
    });

    const calls = spy.mock.calls.filter((c) => JSON.stringify(c[0]) === JSON.stringify({ queryKey: ['escalationStats'] }));
    expect(calls.length).toBe(3);
  });
});

// ── useEscalationListEvents ──────────────────────────────────────────────────

describe('useEscalationListEvents', () => {
  it('without a scope subscribes to the escalation family', () => {
    const { Wrapper } = createWrapper();
    renderHook(() => useEscalationListEvents(), { wrapper: Wrapper });

    expect(subscriptions[0].pattern).toBe('lt.events.system.escalation.*.*.>');
  });

  it('a verb scope subscribes one pattern per verb', () => {
    const { Wrapper } = createWrapper();
    renderHook(() => useEscalationListEvents({ verbs: ['created', 'claimed'] }), { wrapper: Wrapper });

    const patterns = subscriptions.map((s) => s.pattern);
    expect(patterns).toEqual([
      'lt.events.system.escalation.*.*.created',
      'lt.events.system.escalation.*.*.claimed',
    ]);
  });

  it('a role scope narrows every pattern to that queue token', () => {
    const { Wrapper } = createWrapper();
    renderHook(
      () => useEscalationListEvents({ role: 'walk-role', verbs: ['claimed', 'resolved'] }),
      { wrapper: Wrapper },
    );

    const patterns = subscriptions.map((s) => s.pattern);
    expect(patterns).toEqual([
      'lt.events.system.escalation.walk-role.*.claimed',
      'lt.events.system.escalation.walk-role.*.resolved',
    ]);
  });

  it('debounces and invalidates escalations query', () => {
    const { qc, Wrapper } = createWrapper();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useEscalationListEvents(), { wrapper: Wrapper });

    subscriptions[0].handler(makeEvent({ type: 'system.escalation.order-review.esc-001.resolved' }));

    act(() => { vi.advanceTimersByTime(LIST_FLUSH_MS); });

    expect(spy).toHaveBeenCalledWith({ queryKey: ['escalations'] });
  });
});

// ── useEscalationDetailEvents ─────────────────────────────────────────────────

describe('useEscalationDetailEvents', () => {
  it('subscribes to that item across role hops', () => {
    const { Wrapper } = createWrapper();
    renderHook(() => useEscalationDetailEvents('esc-1'), { wrapper: Wrapper });

    expect(subscriptions[0].pattern).toBe('lt.events.system.escalation.*.esc-1.>');
  });

  it("invalidates ONLY this record's key — list and stats have their own subscriptions", () => {
    const { qc, Wrapper } = createWrapper();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useEscalationDetailEvents('esc-1'), { wrapper: Wrapper });

    subscriptions[0].handler(makeEvent({ type: 'system.escalation.order-review.esc-1.resolved', escalationId: 'esc-1' }));

    act(() => { vi.advanceTimersByTime(DETAIL_FLUSH_MS); });

    expect(spy).toHaveBeenCalledWith({ queryKey: ['escalations', 'esc-1'] });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ['escalations'] });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ['escalationStats'] });
  });

  it('ignores events for a different escalationId', () => {
    const { qc, Wrapper } = createWrapper();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useEscalationDetailEvents('esc-1'), { wrapper: Wrapper });

    subscriptions[0].handler(makeEvent({ type: 'system.escalation.order-review.esc-other.created', escalationId: 'esc-other' }));

    act(() => { vi.advanceTimersByTime(DETAIL_FLUSH_MS); });

    expect(spy).not.toHaveBeenCalled();
  });
});

// ── useProcessListEvents ─────────────────────────────────────────────────────

describe('useProcessListEvents', () => {
  it('subscribes to task.> and workflow.> patterns', () => {
    const { Wrapper } = createWrapper();
    renderHook(() => useProcessListEvents(), { wrapper: Wrapper });

    const patterns = subscriptions.map((s) => s.pattern);
    expect(patterns).toContain('lt.events.system.task.>');
    expect(patterns).toContain('lt.events.system.workflow.>');
  });

  it('debounces and invalidates processes query on task event', () => {
    const { qc, Wrapper } = createWrapper();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useProcessListEvents(), { wrapper: Wrapper });

    const taskSub = subscriptions.find((s) => s.pattern === 'lt.events.system.task.>');
    taskSub!.handler(makeEvent({ type: 'system.task.tsk-001.started' }));

    act(() => { vi.advanceTimersByTime(LIST_FLUSH_MS); });

    expect(spy).toHaveBeenCalledWith({ queryKey: ['processes'] });
  });
});
