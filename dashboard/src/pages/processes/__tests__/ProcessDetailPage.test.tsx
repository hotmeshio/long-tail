import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';

vi.mock('../../../api/tasks', () => ({
  useProcessDetail: vi.fn(),
}));

vi.mock('../../../api/settings', () => ({
  useSettings: vi.fn(),
}));

vi.mock('../../../api/users', () => ({
  useUsers: vi.fn().mockReturnValue({ data: [] }),
  useUser: vi.fn().mockReturnValue({ data: null }),
}));

import { ProcessDetailPage } from '../ProcessDetailPage';
import { useProcessDetail } from '../../../api/tasks';
import { useSettings } from '../../../api/settings';
import type { LTTaskRecord, LTEscalationRecord } from '../../../api/types';

function makeTask(overrides: Partial<LTTaskRecord> = {}): LTTaskRecord {
  return {
    id: 'task-1',
    workflow_id: 'wf-abc-123',
    workflow_type: 'reviewContent',
    lt_type: 'leaf',
    task_queue: 'long-tail',
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

function makeEscalation(overrides: Partial<LTEscalationRecord> = {}): LTEscalationRecord {
  return {
    id: 'esc-1',
    type: 'human',
    subtype: 'review',
    description: 'Needs review',
    status: 'resolved',
    priority: 2,
    task_id: 'task-1',
    origin_id: 'origin-1',
    parent_id: null,
    workflow_id: 'wf-esc-1',
    task_queue: 'long-tail',
    workflow_type: 'reviewContent',
    role: 'reviewer',
    assigned_to: 'user-1',
    assigned_until: '2026-01-15T10:30:00Z',
    resolved_at: '2026-01-15T10:05:00Z',
    claimed_at: '2026-01-15T10:02:00Z',
    envelope: '{}',
    metadata: null,
    escalation_payload: null,
    resolver_payload: null,
    created_at: '2026-01-15T10:01:00Z',
    updated_at: '2026-01-15T10:05:00Z',
    trace_id: null,
    span_id: null,
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

describe('ProcessDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useSettings).mockReturnValue({ data: { telemetry: { traceUrl: 'https://ui.honeycomb.io/trace?trace_id={traceId}' } } } as any);
  });

  it('renders trace CopyableId for tasks with trace_id when expanded', () => {
    vi.mocked(useProcessDetail).mockReturnValue({
      data: { origin_id: 'origin-1', tasks: [makeTask()], escalations: [] },
      isLoading: false,
    } as any);

    renderPage();

    // Click "Expand all" to reveal detail panels
    fireEvent.click(screen.getByText('Expand all'));

    expect(screen.getByText('Trace Details')).toBeInTheDocument();
    expect(screen.getByTitle('Copy trace ID')).toBeInTheDocument();
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
    fireEvent.click(screen.getByText('Expand all'));

    expect(screen.queryByText('Trace')).not.toBeInTheDocument();
  });

  it('shows summary stats', () => {
    vi.mocked(useProcessDetail).mockReturnValue({
      data: {
        origin_id: 'origin-1',
        tasks: [makeTask(), makeTask({ id: 'task-2', status: 'needs_intervention', created_at: '2026-01-15T10:02:00Z' })],
        escalations: [],
      },
      isLoading: false,
    } as any);

    renderPage();

    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.getByText('1/2')).toBeInTheDocument();
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

  it('renders task and escalation lanes in the swimlane timeline', () => {
    vi.mocked(useProcessDetail).mockReturnValue({
      data: {
        origin_id: 'origin-1',
        tasks: [makeTask()],
        escalations: [makeEscalation()],
      },
      isLoading: false,
    } as any);

    renderPage();

    // Task lane label
    expect(screen.getByText('reviewContent')).toBeInTheDocument();
    // Escalation lane label (role)
    expect(screen.getByText('reviewer')).toBeInTheDocument();
    // Legend items
    expect(screen.getByText('Task')).toBeInTheDocument();
    expect(screen.getByText('Escalation')).toBeInTheDocument();
  });

  it('shows escalation detail panel with claim info when expanded', () => {
    vi.mocked(useProcessDetail).mockReturnValue({
      data: {
        origin_id: 'origin-1',
        tasks: [makeTask()],
        escalations: [makeEscalation()],
      },
      isLoading: false,
    } as any);

    renderPage();
    fireEvent.click(screen.getByText('Expand all'));

    expect(screen.getByText('Escalation Details')).toBeInTheDocument();
    expect(screen.getAllByText(/reviewer/).length).toBeGreaterThanOrEqual(2);
  });

  it('shows empty state when no events', () => {
    vi.mocked(useProcessDetail).mockReturnValue({
      data: { origin_id: 'origin-1', tasks: [], escalations: [] },
      isLoading: false,
    } as any);

    renderPage();

    expect(screen.getByText('No events in this process.')).toBeInTheDocument();
  });
});
