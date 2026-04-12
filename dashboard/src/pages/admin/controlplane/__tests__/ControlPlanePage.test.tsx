import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockApps = { apps: [{ appId: 'durable' }, { appId: 'hmsh' }] };
const mockProfiles = {
  profiles: [
    {
      namespace: 'durable',
      app_id: 'durable',
      engine_id: 'Hengine1234567890',
      stream: 'hmsh:durable:x:',
      throttle: 0,
    },
    {
      namespace: 'durable',
      app_id: 'durable',
      engine_id: 'Hworker1234567890',
      worker_topic: 'long-tail-system-mcpTriage',
      throttle: 0,
      counts: { '200': 100, '500': 2 },
      stream_depth: 5,
    },
    {
      namespace: 'durable',
      app_id: 'durable',
      engine_id: 'Hworker2345678901',
      worker_topic: 'long-tail-examples-reviewContent',
      throttle: -1,
      counts: { '200': 50 },
    },
  ],
};
const mockStreamStats = { pending: 0, processed: 1234, byStream: [
  { stream_type: 'engine', stream_name: 'hmsh:durable:x:', count: 900 },
  { stream_type: 'worker', stream_name: 'long-tail-system', count: 334 },
] };

vi.mock('../../../../api/controlplane', () => ({
  useControlPlaneApps: () => ({ data: mockApps }),
  useRollCall: () => ({ data: mockProfiles, isLoading: false, refetch: vi.fn(), isFetching: false }),
  useStreamStats: () => ({ data: mockStreamStats }),
  useThrottle: () => ({ mutate: vi.fn(), isPending: false }),
  useSubscribeMesh: () => ({ mutate: vi.fn() }),
}));

vi.mock('../../../../hooks/useEventContext', () => ({
  useEventSubscription: vi.fn(),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin/controlplane']}>
        <ControlPlanePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

import { ControlPlanePage } from '../ControlPlanePage';

// ── Tests ───────────────────────────────────────────────────────────────────

describe('ControlPlanePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders page header with stats', () => {
    renderPage();
    expect(screen.getByText('Task Queues')).toBeInTheDocument();
    // Inline stats
    expect(screen.getAllByText('Engines').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Queues').length).toBeGreaterThanOrEqual(1);
  });

  it('shows engine and worker counts in header stats', () => {
    renderPage();
    // 1 engine, 2 workers, 2 queues
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1);
  });

  it('renders emergency controls', () => {
    renderPage();
    expect(screen.getByText('Pause All')).toBeInTheDocument();
    expect(screen.getByText('Resume All')).toBeInTheDocument();
  });

  it('renders Worker Queues collapsible section with queue cards', () => {
    renderPage();
    expect(screen.getByText('Worker Queues')).toBeInTheDocument();
    // Queue names shown via TaskQueuePill
    expect(screen.getByText('long-tail-system-mcpTriage')).toBeInTheDocument();
    expect(screen.getByText('long-tail-examples-reviewContent')).toBeInTheDocument();
  });

  it('renders Engines collapsible section', () => {
    renderPage();
    expect(screen.getAllByText('Engines').length).toBeGreaterThanOrEqual(1);
  });

  it('shows throttled indicator when workers are throttled', () => {
    renderPage();
    expect(screen.getByText('Throttled')).toBeInTheDocument();
  });

  it('renders duration tabs', () => {
    renderPage();
    expect(screen.getByText('15m')).toBeInTheDocument();
    expect(screen.getByText('1h')).toBeInTheDocument();
    expect(screen.getByText('7d')).toBeInTheDocument();
  });

  it('renders application filter', () => {
    renderPage();
    expect(screen.getByText('Application')).toBeInTheDocument();
  });

  it('renders stream volume section', () => {
    renderPage();
    expect(screen.getByText(/Stream Volume/)).toBeInTheDocument();
  });

  it('renders quorum feed panel', () => {
    renderPage();
    expect(screen.getByText('Event Stream')).toBeInTheDocument();
  });

  it('renders roll call button', () => {
    renderPage();
    expect(screen.getByText('Roll Call')).toBeInTheDocument();
  });
});
