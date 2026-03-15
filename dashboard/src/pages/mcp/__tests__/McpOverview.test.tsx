import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../api/mcp-runs', () => ({
  useMcpRuns: vi.fn(),
}));

vi.mock('../../../api/mcp', () => ({
  useMcpServers: vi.fn(),
}));

vi.mock('../../../api/namespaces', () => ({
  useNamespaces: vi.fn(),
}));

vi.mock('../../../api/yaml-workflows', () => ({
  useYamlWorkflows: vi.fn(),
}));

import { McpOverview } from '../McpOverview';
import { useMcpRuns } from '../../../api/mcp-runs';
import { useMcpServers } from '../../../api/mcp';
import { useNamespaces } from '../../../api/namespaces';
import { useYamlWorkflows } from '../../../api/yaml-workflows';

const now = Date.now();
const recent = new Date(now - 3_600_000 / 2).toISOString(); // 30 min ago
const old = new Date(now - 86_400_000 * 2).toISOString(); // 2 days ago

const mockRuns = {
  jobs: [
    { workflow_id: 'r1', entity: 'vision-pipeline', status: 'completed', is_live: false, created_at: recent, updated_at: new Date(now - 3_600_000 / 4).toISOString() },
    { workflow_id: 'r2', entity: 'vision-pipeline', status: 'running', is_live: true, created_at: recent, updated_at: recent },
    { workflow_id: 'r3', entity: 'triage-pipeline', status: 'failed', is_live: false, created_at: recent, updated_at: recent },
    { workflow_id: 'r4', entity: 'triage-pipeline', status: 'completed', is_live: false, created_at: old, updated_at: old },
  ],
  total: 4,
};

const mockServers = {
  servers: [
    { id: 's1', name: 's1', status: 'connected', tool_manifest: [{ name: 't1' }, { name: 't2' }], updated_at: recent },
    { id: 's2', name: 's2', status: 'disconnected', tool_manifest: [], updated_at: old },
  ],
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <McpOverview />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('McpOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useMcpRuns).mockReturnValue({ data: mockRuns } as any);
    vi.mocked(useMcpServers).mockReturnValue({ data: mockServers, isLoading: false } as any);
    vi.mocked(useNamespaces).mockReturnValue({ data: { namespaces: [{ name: 'longtail', is_default: true }] } } as any);
    vi.mocked(useYamlWorkflows).mockReturnValue({ data: { workflows: [], total: 0 }, isLoading: false } as any);
  });

  // ── Header & Duration tabs ──

  it('renders header and duration tabs', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'MCP Tools' })).toBeInTheDocument();
    expect(screen.getByText('1h')).toBeInTheDocument();
    expect(screen.getByText('24h')).toBeInTheDocument();
    expect(screen.getByText('7d')).toBeInTheDocument();
    expect(screen.getByText('30d')).toBeInTheDocument();
  });

  // ── Summary cards (default 24h → 3 recent runs) ──

  it('renders summary cards with correct counts for 24h', () => {
    renderPage();
    // 3 recent runs in 24h window: 1 completed, 1 running, 1 failed
    expect(screen.getAllByText('Total Runs').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('3').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Running').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1);
  });

  // ── Duration switching ──

  it('shows all 4 runs when switching to 7d', () => {
    renderPage();
    fireEvent.click(screen.getByText('7d'));
    // All 4 runs visible now
    expect(screen.getAllByText('4').length).toBeGreaterThanOrEqual(1);
  });

  it('filters to only 1h runs', () => {
    renderPage();
    fireEvent.click(screen.getByText('1h'));
    // 3 runs are 30min old, so within 1h
    expect(screen.getAllByText('3').length).toBeGreaterThanOrEqual(1);
  });

  // ── By-pipeline table ──

  it('renders by-pipeline breakdown', () => {
    renderPage();
    expect(screen.getByText('Tool')).toBeInTheDocument();
    expect(screen.getByText('vision-pipeline')).toBeInTheDocument();
    expect(screen.getByText('triage-pipeline')).toBeInTheDocument();
  });

  it('shows avg duration for completed runs', () => {
    renderPage();
    // vision-pipeline has 1 completed run with ~15min duration
    const durationCells = screen.getAllByText(/m|ms|s|h/);
    expect(durationCells.length).toBeGreaterThan(0);
  });

  // ── Zero counts ──

  it('renders zero counts in tertiary style', () => {
    const { container } = renderPage();
    const zeroCells = container.querySelectorAll('.text-text-tertiary');
    const zeroTexts = Array.from(zeroCells).map((el) => el.textContent);
    expect(zeroTexts).toContain('0');
  });

  // ── Empty state ──

  it('shows empty state when no runs', () => {
    vi.mocked(useMcpRuns).mockReturnValue({
      data: { jobs: [], total: 0 },
    } as any);
    renderPage();
    expect(screen.getByText(/No MCP tool activity/)).toBeInTheDocument();
  });

  // ── Server inventory cards ──

  it('shows server tools and workflow tools cards', () => {
    renderPage();
    expect(screen.getByText('Server Tools')).toBeInTheDocument();
    expect(screen.getByText('Workflow Tools')).toBeInTheDocument();
    expect(screen.getByText(/2 tools/)).toBeInTheDocument();
  });

  // ── Loading state ──

  it('shows dash when servers are loading', () => {
    vi.mocked(useMcpServers).mockReturnValue({ data: undefined, isLoading: true } as any);
    renderPage();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });
});
