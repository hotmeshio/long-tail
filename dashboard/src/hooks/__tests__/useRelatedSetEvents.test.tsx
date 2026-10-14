import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { REALTIME_REFRESH } from '../../lib/realtime-refresh';
import { useRelatedSetEvents } from '../useEventHooks';

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

const LIST_FLUSH_MS = REALTIME_REFRESH.LIST.coalesceMs + 50;

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return {
    qc,
    Wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  };
}

beforeEach(() => {
  subscriptions.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useRelatedSetEvents', () => {
  it('follows every verb of each distinct role a set reads', () => {
    const { Wrapper } = createWrapper();
    renderHook(() => useRelatedSetEvents(['stage', 'prep', 'stage']), { wrapper: Wrapper });
    expect(subscriptions.map((s) => s.pattern)).toEqual([
      'lt.events.system.escalation.prep.*.>',
      'lt.events.system.escalation.stage.*.>',
    ]);
  });

  it('refreshes the related reads when a held item row changes', () => {
    const { qc, Wrapper } = createWrapper();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useRelatedSetEvents(['stage']), { wrapper: Wrapper });

    subscriptions[0].handler({ type: 'system.escalation.stage.esc-1.updated', escalationId: 'esc-1' });
    act(() => { vi.advanceTimersByTime(LIST_FLUSH_MS); });

    expect(spy).toHaveBeenCalledWith({ queryKey: ['escalations', 'related'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['escalations', 'related-rows'] });
  });

  it('subscribes to nothing when no set names a role', () => {
    const { Wrapper } = createWrapper();
    renderHook(() => useRelatedSetEvents([]), { wrapper: Wrapper });
    expect(subscriptions).toEqual([]);
  });
});
