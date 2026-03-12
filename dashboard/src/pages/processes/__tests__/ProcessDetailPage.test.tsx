import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';

vi.mock('../../../api/tasks', () => ({
  useProcessDetail: vi.fn(),
}));

vi.mock('../../../api/settings', () => ({
  useSettings: vi.fn(),
}));

import { ProcessDetailPage } from '../ProcessDetailPage';
import { useProcessDetail } from '../../../api/tasks';
import { useSettings } from '../../../api/settings';
import type { LTTaskRecord } from '../../../api/types';

function makeTask(overrides: Partial<LTTaskRecord> = {}): LTTaskRecord {
  return {
    id: 'task-1',
    workflow_id: 'wf-abc-123',
    workflow_type: 'reviewContent',
    lt_type: 'leaf',
    task_queue: 'long-tail',
    modality: 'ai',
    status: 'completed',
    priority: 2,
    signal_id: 'sig-1',
    parent_workflow_id: 'parent-1',
    origin_id: 'origin-1',
    parent_id: null,
    started_at: '2026-01-15T10:00:00Z',
    completed_at: '2026-01-15T10:01:00Z',
    envelope: '{}',
    metadata: null,
    error: null,
    milestones: [],
    data: null,
    trace_id: 'abc123trace',
    span_id: 'span456',
    created_at: '2026-01-15T10:00:00Z',
    updated_at: '2026-01-15T10:01:00Z',
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/processes/detail/origin-1']}>
        <Routes>
          <Route path="/processes/detail/:originId" element={<ProcessDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProcessDetailPage — Trace ID', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useSettings).mockReturnValue({ data: { telemetry: { traceUrl: 'https://ui.honeycomb.io/trace?trace_id={traceId}' } } } as any);
  });

  it('renders trace CopyableId for tasks with trace_id', () => {
    vi.mocked(useProcessDetail).mockReturnValue({
      data: { origin_id: 'origin-1', tasks: [makeTask()], escalations: [] },
      isLoading: false,
    } as any);

    renderPage();

    expect(screen.getByText('Trace')).toBeInTheDocument();
    expect(screen.getByText('abc123trace')).toBeInTheDocument();
  });

  it('does NOT render trace for tasks without trace_id', () => {
    vi.mocked(useProcessDetail).mockReturnValue({
      data: {
        origin_id: 'origin-1',
        tasks: [makeTask({ trace_id: null })],
        escalations: [],
      },
      isLoading: false,
    } as any);

    renderPage();

    expect(screen.queryByText('Trace')).not.toBeInTheDocument();
  });

  it('shows summary stats', () => {
    vi.mocked(useProcessDetail).mockReturnValue({
      data: {
        origin_id: 'origin-1',
        tasks: [makeTask(), makeTask({ id: 'task-2', status: 'needs_intervention' })],
        escalations: [],
      },
      isLoading: false,
    } as any);

    renderPage();

    // Summary cards should show task count
    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows loading skeleton when data is loading', () => {
    vi.mocked(useProcessDetail).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as any);

    renderPage();

    const pulseElements = document.querySelectorAll('.animate-pulse');
    expect(pulseElements.length).toBeGreaterThan(0);
  });
});
