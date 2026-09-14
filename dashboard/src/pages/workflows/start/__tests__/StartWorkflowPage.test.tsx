import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { REVIEW, CLAIM, DURABLE } from './invoke-test-data';

let invocableOverride: { data: unknown; isLoading: boolean } | undefined;

vi.mock('../../../../api/workflows', () => ({
  useInvocableWorkflows: () => invocableOverride ?? ({ data: [REVIEW, CLAIM, DURABLE], isLoading: false }),
  useCronStatus: () => ({ data: [{ workflow_type: 'reviewContent', active: true, cron_schedule: '0 * * * *' }] }),
  useInvokeWorkflow: () => ({ mutateAsync: vi.fn(), isPending: false, isSuccess: false, error: null, reset: vi.fn() }),
}));
vi.mock('../../../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { username: 'testuser', displayName: 'Test User' }, isSuperAdmin: false, hasRoleType: () => false }),
}));
vi.mock('../../../../hooks/useAccess', () => ({ useAccess: () => ({ realIsBuilder: false }) }));
vi.mock('../../../../api/bots', () => ({ useBots: () => ({ data: { bots: [] } }) }));
vi.mock('../../../../hooks/useMediaQuery', () => ({ useMediaQuery: () => false }));

import { StartWorkflowPage } from '../StartWorkflowPage';

function renderPage(initialEntries = ['/workflows/durable/invoke']) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={initialEntries}>
        <StartWorkflowPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('StartWorkflowPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invocableOverride = undefined;
  });

  it('renders the page header and no schedule toggle', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Invoke Tool' })).toBeInTheDocument();
    expect(screen.queryByText('Schedule')).not.toBeInTheDocument();
  });

  it('lists every invokable workflow grouped by queue in the list column', () => {
    renderPage();
    const list = screen.getByTestId('invoke-list');
    expect(list).toHaveTextContent('Long Tail Examples Review Content');
    expect(list).toHaveTextContent('Review Content');
    expect(list).toHaveTextContent('Process Claim');
    expect(list).toHaveTextContent('Durable Only');
  });

  it('preselects the first row of the first queue group and renders its form in the page', () => {
    renderPage();
    expect(screen.getByTestId('invoke-form')).toHaveTextContent('Durable Only');
    expect(screen.getByTestId('invoke-form')).toHaveTextContent('durableOnly');
    expect(screen.getByTestId('invoke-start')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Durable Only/ })).toHaveAttribute('aria-current', 'true');
  });

  it('a ?type= deep link wins over the preselect', () => {
    renderPage(['/workflows/durable/invoke?type=processClaim']);
    expect(screen.getByText('Process insurance claims')).toBeInTheDocument();
    expect(screen.getByText('lt-system')).toBeInTheDocument();
  });

  it('shows the loading skeleton while the list loads', () => {
    invocableOverride = { data: undefined, isLoading: true };
    const { container } = renderPage();
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('shows the empty state when the caller has nothing to invoke', () => {
    invocableOverride = { data: [], isLoading: false };
    renderPage();
    expect(screen.getByText('No tools to invoke')).toBeInTheDocument();
  });
});
