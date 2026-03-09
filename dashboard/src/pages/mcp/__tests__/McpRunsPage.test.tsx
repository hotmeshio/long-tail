import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../api/mcp-runs', () => ({
  useMcpRuns: vi.fn(),
  useMcpEntities: vi.fn(),
}));

vi.mock('../../../api/yaml-workflows', () => ({
  useYamlWorkflowAppIds: vi.fn(),
}));

import { McpRunsPage } from '../McpRunsPage';
import { useMcpRuns, useMcpEntities } from '../../../api/mcp-runs';
import { useYamlWorkflowAppIds } from '../../../api/yaml-workflows';

const now = new Date().toISOString();

const mockRuns = {
  jobs: [
    { workflow_id: 'j1', entity: 'rotate_and_verify', status: 'completed', is_live: false, created_at: now, updated_at: now },
    { workflow_id: 'j2', entity: 'rotate_and_verify', status: 'running', is_live: true, created_at: now, updated_at: now },
    { workflow_id: 'j3', entity: null, status: 'completed', is_live: false, created_at: now, updated_at: now },
  ],
  total: 3,
};

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

function wrapperWithParams(search: string) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return (
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/mcp/runs${search}`]}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  };
}

beforeEach(() => {
  vi.mocked(useMcpRuns).mockReturnValue({ data: mockRuns, isLoading: false } as any);
  vi.mocked(useMcpEntities).mockReturnValue({ data: { entities: ['rotate_and_verify'] } } as any);
  vi.mocked(useYamlWorkflowAppIds).mockReturnValue({ data: { app_ids: ['longtail'] } } as any);
});

/** Find a FilterSelect's <select> by its adjacent label text */
function findFilterSelect(labelText: string): HTMLSelectElement | null {
  const labels = screen.getAllByText(labelText);
  for (const label of labels) {
    const container = label.closest('div');
    if (container) {
      const select = container.querySelector('select');
      if (select) return select;
    }
  }
  return null;
}

describe('McpRunsPage', () => {
  it('renders page header', () => {
    render(<McpRunsPage />, { wrapper });
    expect(screen.getByText('Workflow Runs')).toBeInTheDocument();
  });

  it('renders job rows with entity', () => {
    render(<McpRunsPage />, { wrapper });
    const cells = screen.getAllByText('rotate_and_verify');
    expect(cells.length).toBeGreaterThanOrEqual(1);
  });

  it('shows dash for null entity', () => {
    render(<McpRunsPage />, { wrapper });
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders Tool filter with entity options', () => {
    render(<McpRunsPage />, { wrapper });
    const select = findFilterSelect('Tool');
    expect(select).toBeTruthy();
    expect(select!.querySelector('option[value="rotate_and_verify"]')).toBeTruthy();
  });

  it('renders Status filter', () => {
    render(<McpRunsPage />, { wrapper });
    const select = findFilterSelect('Status');
    expect(select).toBeTruthy();
  });

  it('shows empty message when no jobs', () => {
    vi.mocked(useMcpRuns).mockReturnValue({ data: { jobs: [], total: 0 }, isLoading: false } as any);
    render(<McpRunsPage />, { wrapper });
    expect(screen.getByText('No workflow server runs found')).toBeInTheDocument();
  });

  it('includes URL entity param in filter options even if not from API', () => {
    vi.mocked(useMcpEntities).mockReturnValue({ data: { entities: [] } } as any);
    render(<McpRunsPage />, { wrapper: wrapperWithParams('?entity=custom_topic&namespace=lt-yaml') });
    const select = findFilterSelect('Tool');
    expect(select).toBeTruthy();
    expect(select!.querySelector('option[value="custom_topic"]')).toBeTruthy();
  });

  it('always shows namespace filter', () => {
    render(<McpRunsPage />, { wrapper });
    const select = findFilterSelect('Namespace');
    expect(select).toBeTruthy();
    // Required filter — no "All" option
    expect(select!.querySelector('option[value=""]')).toBeNull();
  });

  it('namespace filter includes options from app-ids API', () => {
    vi.mocked(useYamlWorkflowAppIds).mockReturnValue({
      data: { app_ids: ['longtail', 'lt-yaml'] },
    } as any);
    render(<McpRunsPage />, { wrapper });
    const select = findFilterSelect('Namespace');
    expect(select).toBeTruthy();
    expect(select!.querySelector('option[value="longtail"]')).toBeTruthy();
    expect(select!.querySelector('option[value="lt-yaml"]')).toBeTruthy();
  });

  it('defaults namespace to longtail', () => {
    render(<McpRunsPage />, { wrapper });
    expect(useMcpRuns).toHaveBeenCalledWith(
      expect.objectContaining({ app_id: 'longtail' }),
    );
  });

  it('respects namespace from URL deep-link', () => {
    render(<McpRunsPage />, { wrapper: wrapperWithParams('?namespace=lt-yaml') });
    expect(useMcpRuns).toHaveBeenCalledWith(
      expect.objectContaining({ app_id: 'lt-yaml' }),
    );
    // Deep-linked namespace appears in dropdown even if not from API
    const select = findFilterSelect('Namespace');
    expect(select!.querySelector('option[value="lt-yaml"]')).toBeTruthy();
  });

  it('passes entity filter to useMcpRuns', () => {
    render(<McpRunsPage />, { wrapper: wrapperWithParams('?entity=rotate_and_verify') });
    expect(useMcpRuns).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'rotate_and_verify' }),
    );
  });

  it('passes namespace to useMcpEntities', () => {
    render(<McpRunsPage />, { wrapper: wrapperWithParams('?namespace=custom-ns') });
    expect(useMcpEntities).toHaveBeenCalledWith('custom-ns');
  });
});
