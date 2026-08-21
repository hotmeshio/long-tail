import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { REALTIME_REFRESH, getInvalidationScheduler } from '../../../lib/realtime-refresh';

vi.mock('../../../api/pipelines', () => ({
  useMcpRunExecution: () => ({ data: undefined, isLoading: true, error: null, refetch: vi.fn(), isFetching: false }),
  useInterruptJob: () => ({ error: null, mutate: vi.fn() }),
}));

vi.mock('../../../api/settings', () => ({
  useSettings: () => ({ data: undefined }),
}));

vi.mock('../../../hooks/useCollapsedSections', () => ({
  useCollapsedSections: () => ({ isCollapsed: () => false, toggle: vi.fn() }),
}));

type Handler = (event: any) => void;
const subscriptions: Array<{ pattern: string; handler: Handler }> = [];
vi.mock('../../../hooks/useEventContext', () => ({
  useEventSubscription: (pattern: string, handler: Handler) => {
    subscriptions.push({ pattern, handler });
  },
}));

import { McpRunDetailPage } from '../McpRunDetailPage';

let qc: QueryClient;

function renderPage(jobId = 'wf-1') {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/mcp/runs/${jobId}`]}>
        <Routes>
          <Route path="/mcp/runs/:jobId" element={<McpRunDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const DETAIL_FLUSH_MS = REALTIME_REFRESH.DETAIL.coalesceMs + 50;

beforeEach(() => {
  subscriptions.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  getInvalidationScheduler(qc).dispose();
  vi.useRealTimers();
});

describe('McpRunDetailPage — activity event refresh discipline', () => {
  it("a step-dense burst for this job lands as one DETAIL-tier flush of the job's own key", () => {
    renderPage('wf-1');
    const spy = vi.spyOn(qc, 'invalidateQueries');

    act(() => {
      for (let i = 0; i < 50; i++) {
        subscriptions[0].handler({ type: 'system.activity.wf-1.step.completed', workflowId: 'wf-1' });
      }
    });
    expect(spy).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(DETAIL_FLUSH_MS);
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['mcpRunExecution', 'wf-1'] });
  });

  it("another job's events never invalidate this page", () => {
    renderPage('wf-1');
    const spy = vi.spyOn(qc, 'invalidateQueries');

    act(() => {
      subscriptions[0].handler({ type: 'system.activity.wf-2.step.completed', workflowId: 'wf-2' });
      vi.advanceTimersByTime(DETAIL_FLUSH_MS);
    });
    expect(spy).not.toHaveBeenCalled();
  });
});
