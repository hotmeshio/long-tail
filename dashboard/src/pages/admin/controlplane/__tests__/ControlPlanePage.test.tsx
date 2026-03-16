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
    },
    {
      namespace: 'durable',
      app_id: 'durable',
      engine_id: 'Hworker2345678901',
      worker_topic: 'long-tail-examples-reviewContent',
      throttle: -1,
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

vi.mock('../../../../hooks/useNats', () => ({
  useNatsSubscription: vi.fn(),
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

  it('renders page header', () => {
    renderPage();
    expect(screen.getByText('Mesh Activity')).toBeInTheDocument();
  });

  it('renders summary stat cards', () => {
    renderPage();
    // "Engines" and "Workers" appear in both stat cards and filter dropdown
    expect(screen.getAllByText('Engines').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Workers').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Engine Msgs (1h)')).toBeInTheDocument();
    expect(screen.getByText('Worker Msgs (1h)')).toBeInTheDocument();
  });

  it('shows engine and worker counts from profiles', () => {
    renderPage();
    // 1 engine, 2 workers from mockProfiles
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders engine and worker processed counts from stream stats', () => {
    renderPage();
    // Engine: 900 appears in both stat card and chart bar
    expect(screen.getAllByText('900').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('334').length).toBeGreaterThanOrEqual(1);
  });

  it('renders mesh nodes table with profiles', () => {
    renderPage();
    expect(screen.getByText(/Mesh Nodes/)).toBeInTheDocument();
    expect(screen.getAllByText('Worker').length).toBe(2);
    // "Engine" appears in both the table badge and the chart section header
    expect(screen.getAllByText('Engine').length).toBeGreaterThanOrEqual(1);
  });

  it('shows throttled status for paused workers', () => {
    renderPage();
    expect(screen.getByText('Paused')).toBeInTheDocument();
  });

  it('renders duration tabs', () => {
    renderPage();
    expect(screen.getByText('15m')).toBeInTheDocument();
    expect(screen.getByText('1h')).toBeInTheDocument();
    expect(screen.getByText('7d')).toBeInTheDocument();
  });

  it('renders application and nodes filters', () => {
    renderPage();
    expect(screen.getByText('Application')).toBeInTheDocument();
    expect(screen.getByText('Nodes')).toBeInTheDocument();
  });

  it('renders stream volume section with engine/worker grouping', () => {
    renderPage();
    // Engine stream label in chart
    expect(screen.getByText('(engine)')).toBeInTheDocument();
    // Chart section header
    expect(screen.getByText('Engine Queue')).toBeInTheDocument();
  });

  it('renders quorum feed panel', () => {
    renderPage();
    expect(screen.getByText('Quorum Feed')).toBeInTheDocument();
  });

  it('renders roll call button', () => {
    renderPage();
    expect(screen.getByText('Roll Call')).toBeInTheDocument();
  });

  it('renders checkboxes for each profile row', () => {
    renderPage();
    // 3 profile rows + 1 header checkbox = 4
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBe(4);
  });
});
