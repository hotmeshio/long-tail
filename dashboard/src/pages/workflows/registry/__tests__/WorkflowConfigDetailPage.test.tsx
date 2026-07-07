import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../../api/workflows', () => ({
  useWorkflowConfigs: vi.fn(),
  useUpsertWorkflowConfig: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  })),
  useDeleteWorkflowConfig: vi.fn(() => ({ mutate: vi.fn(), isPending: false, error: null })),
  useJobs: vi.fn(() => ({ data: { jobs: [] } })),
}));

vi.mock('../../../../api/bots', () => ({
  useBots: vi.fn(() => ({ data: { bots: [] } })),
}));

vi.mock('../../../../api/roles', () => ({
  useRoles: vi.fn(() => ({ data: [] })),
}));

import { WorkflowConfigDetailPage } from '../WorkflowConfigDetailPage';
import { useWorkflowConfigs } from '../../../../api/workflows';

const mockConfig = {
  workflow_type: 'assemblyLine',
  description: 'Assembly line workflow',
  task_queue: 'long-tail-examples',
  tier: 'certified',
  registered: true,
  invocable: true,
  default_role: 'reviewer',
  roles: ['reviewer', 'admin'],
  invocation_roles: ['admin'],
  consumes: [],
  envelope_schema: null,
  resolver_schema: null,
  cron_schedule: null,
  execute_as: null,
};

function wrapper({ path, initialPath }: { path: string; initialPath: string }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path={path} element={children} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  };
}

describe('WorkflowConfigDetailPage — edit', () => {
  beforeEach(() => {
    vi.mocked(useWorkflowConfigs).mockReturnValue({ data: [mockConfig], isLoading: false } as any);
  });

  it('renders the workflow type as a heading', () => {
    render(<WorkflowConfigDetailPage />, {
      wrapper: wrapper({ path: '/workflows/registry/:workflowType', initialPath: '/workflows/registry/assemblyLine' }),
    });
    expect(screen.getByText('assemblyLine')).toBeInTheDocument();
  });

  it('renders three section headers', () => {
    render(<WorkflowConfigDetailPage />, {
      wrapper: wrapper({ path: '/workflows/registry/:workflowType', initialPath: '/workflows/registry/assemblyLine' }),
    });
    expect(screen.getByText('Identity')).toBeInTheDocument();
    expect(screen.getByText('Invocation')).toBeInTheDocument();
    expect(screen.getByText('Certification')).toBeInTheDocument();
  });

  it('renders Save button (not Next)', () => {
    render(<WorkflowConfigDetailPage />, {
      wrapper: wrapper({ path: '/workflows/registry/:workflowType', initialPath: '/workflows/registry/assemblyLine' }),
    });
    expect(screen.getByText('Save')).toBeInTheDocument();
    expect(screen.queryByText('Next')).not.toBeInTheDocument();
  });

  it('shows durable namespace pill for existing workflow', () => {
    render(<WorkflowConfigDetailPage />, {
      wrapper: wrapper({ path: '/workflows/registry/:workflowType', initialPath: '/workflows/registry/assemblyLine' }),
    });
    // NamespacePill renders the namespace as text
    expect(screen.getByText('durable')).toBeInTheDocument();
  });
});

describe('WorkflowConfigDetailPage — new', () => {
  beforeEach(() => {
    vi.mocked(useWorkflowConfigs).mockReturnValue({ data: [], isLoading: false } as any);
  });

  it('renders "New Workflow" heading', () => {
    render(<WorkflowConfigDetailPage />, {
      wrapper: wrapper({ path: '/workflows/registry/new', initialPath: '/workflows/registry/new' }),
    });
    expect(screen.getByText('New Workflow')).toBeInTheDocument();
  });

  it('renders Register button for new workflow', () => {
    render(<WorkflowConfigDetailPage />, {
      wrapper: wrapper({ path: '/workflows/registry/new', initialPath: '/workflows/registry/new' }),
    });
    expect(screen.getByText('Register')).toBeInTheDocument();
  });

  it('shows loading skeleton when loading', () => {
    vi.mocked(useWorkflowConfigs).mockReturnValue({ data: undefined, isLoading: true } as any);
    const { container } = render(<WorkflowConfigDetailPage />, {
      wrapper: wrapper({ path: '/workflows/registry/new', initialPath: '/workflows/registry/new' }),
    });
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });
});
