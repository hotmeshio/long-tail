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
  { stream_name: 'hmsh:durable:x:', count: 900 },
  { stream_name: 'hmsh:durable:x:long-tail-system-mcpTriage', count: 334 },
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
    expect(screen.getByText('Control Plane')).toBeInTheDocument();
  });

  it('renders summary stat cards', () => {
    renderPage();
    expect(screen.getByText('Engines')).toBeInTheDocument();
    expect(screen.getByText('Workers')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('shows engine and worker counts from profiles', () => {
    renderPage();
    // 1 engine, 2 workers from mockProfiles
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders processed count from stream stats', () => {
    renderPage();
    expect(screen.getByText('1,234')).toBeInTheDocument();
  });

  it('renders mesh nodes table with profiles', () => {
    renderPage();
    expect(screen.getByText('Mesh Nodes')).toBeInTheDocument();
    expect(screen.getAllByText('Worker').length).toBe(2);
    expect(screen.getByText('Engine')).toBeInTheDocument();
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

  it('renders application filter', () => {
    renderPage();
    expect(screen.getByText('Application')).toBeInTheDocument();
  });

  it('renders stream volume section', () => {
    renderPage();
    // stripStreamPrefix('hmsh:durable:x:') → '(engine)'
    expect(screen.getByText('(engine)')).toBeInTheDocument();
    expect(screen.getByText('900')).toBeInTheDocument();
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
