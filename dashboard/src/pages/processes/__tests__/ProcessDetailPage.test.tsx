import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';

vi.mock('../../../api/tasks', () => ({
  useProcessDetail: vi.fn(),
}));

vi.mock('../../../api/insight', () => ({
  useInsightQuery: vi.fn(),
}));

import { ProcessDetailPage } from '../ProcessDetailPage';
import { useProcessDetail } from '../../../api/tasks';
import { useInsightQuery } from '../../../api/insight';
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
  return render(
    <MemoryRouter initialEntries={['/processes/detail/origin-1']}>
      <Routes>
        <Route path="/processes/detail/:originId" element={<ProcessDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProcessDetailPage — Telemetry Pill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useInsightQuery).mockReturnValue({
      data: null,
      isFetching: false,
      error: null,
    } as any);
  });

  it('renders "Get Telemetry" pill for tasks with trace_id', () => {
    vi.mocked(useProcessDetail).mockReturnValue({
      data: { origin_id: 'origin-1', tasks: [makeTask()], escalations: [] },
      isLoading: false,
    } as any);

    renderPage();

    expect(screen.getByText('Get Telemetry')).toBeInTheDocument();
  });

  it('does NOT render pill for tasks without trace_id', () => {
    vi.mocked(useProcessDetail).mockReturnValue({
      data: {
        origin_id: 'origin-1',
        tasks: [makeTask({ trace_id: null })],
        escalations: [],
      },
      isLoading: false,
    } as any);

    renderPage();

    expect(screen.queryByText('Get Telemetry')).not.toBeInTheDocument();
  });

  it('clicking pill triggers insight query with workflow_id', () => {
    vi.mocked(useProcessDetail).mockReturnValue({
      data: { origin_id: 'origin-1', tasks: [makeTask()], escalations: [] },
      isLoading: false,
    } as any);

    renderPage();

    fireEvent.click(screen.getByText('Get Telemetry'));

    // useInsightQuery should have been called with a question containing the workflow_id
    const calls = vi.mocked(useInsightQuery).mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[0]).toContain('wf-abc-123');
  });

  it('shows loading skeleton when insight is fetching', () => {
    vi.mocked(useProcessDetail).mockReturnValue({
      data: { origin_id: 'origin-1', tasks: [makeTask()], escalations: [] },
      isLoading: false,
    } as any);

    vi.mocked(useInsightQuery).mockReturnValue({
      data: null,
      isFetching: true,
      error: null,
    } as any);

    renderPage();

    // Loading skeleton has animate-pulse divs
    const pulseElements = document.querySelectorAll('.animate-pulse');
    expect(pulseElements.length).toBeGreaterThan(0);
  });

  it('shows InsightResultCard when data is returned', () => {
    vi.mocked(useProcessDetail).mockReturnValue({
      data: { origin_id: 'origin-1', tasks: [makeTask()], escalations: [] },
      isLoading: false,
    } as any);

    vi.mocked(useInsightQuery).mockReturnValue({
      data: {
        title: 'Workflow Execution Timeline',
        summary: 'The workflow completed in 1.2s with no errors.',
        sections: [],
        metrics: [{ label: 'Duration', value: '1.2s' }],
        tool_calls_made: 2,
        query: 'Get telemetry...',
        workflow_id: 'insight-123',
        duration_ms: 3400,
      },
      isFetching: false,
      error: null,
    } as any);

    renderPage();

    expect(screen.getByText('Workflow Execution Timeline')).toBeInTheDocument();
    expect(screen.getByText('The workflow completed in 1.2s with no errors.')).toBeInTheDocument();
  });

  it('shows error message when insight query fails', () => {
    vi.mocked(useProcessDetail).mockReturnValue({
      data: { origin_id: 'origin-1', tasks: [makeTask()], escalations: [] },
      isLoading: false,
    } as any);

    vi.mocked(useInsightQuery).mockReturnValue({
      data: null,
      isFetching: false,
      error: new Error('Insight service unavailable'),
    } as any);

    renderPage();

    expect(screen.getByText('Insight service unavailable')).toBeInTheDocument();
  });

  it('disables pill when insight is fetching', () => {
    vi.mocked(useProcessDetail).mockReturnValue({
      data: { origin_id: 'origin-1', tasks: [makeTask()], escalations: [] },
      isLoading: false,
    } as any);

    vi.mocked(useInsightQuery).mockReturnValue({
      data: null,
      isFetching: true,
      error: null,
    } as any);

    renderPage();

    const pill = screen.getByText('Get Telemetry');
    expect(pill).toBeDisabled();
  });
});
