import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Below xl the list folds into a grouped select and the invoke form renders
// inline at full width — the shell panel never opens.

const mockConfigs = [
  {
    workflow_type: 'reviewContent',
    task_queue: 'long-tail-examples-reviewContent',
    invocable: true,
    description: 'Review user-generated content',
    default_role: 'reviewer',
    roles: ['reviewer'],
    invocation_roles: [],
    consumes: [],
    envelope_schema: null,
    resolver_schema: null,
    cron_schedule: null,
    execute_as: null,
  },
  {
    workflow_type: 'processClaim',
    task_queue: 'long-tail-examples-processClaim',
    invocable: true,
    description: 'Process insurance claims',
    default_role: 'reviewer',
    roles: ['adjuster'],
    invocation_roles: [],
    consumes: [],
    envelope_schema: null,
    resolver_schema: null,
    cron_schedule: null,
    execute_as: null,
  },
];

vi.mock('../../../../api/workflows', () => ({
  useWorkflowConfigs: () => ({ data: mockConfigs, isLoading: false }),
  useDiscoveredWorkflows: () => ({ data: [], isLoading: false }),
  useCronStatus: () => ({ data: [] }),
  useInvokeWorkflow: () => ({ mutateAsync: vi.fn(), isPending: false, isSuccess: false, error: null, reset: vi.fn() }),
}));

vi.mock('../../../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { username: 'testuser', displayName: 'Test User' },
    isSuperAdmin: false,
    hasRoleType: () => false,
  }),
}));

vi.mock('../../../../api/bots', () => ({
  useBots: () => ({ data: { bots: [] } }),
}));

const mockSetPanel = vi.fn();
const mockClosePanel = vi.fn();
vi.mock('../../../../hooks/useShellPanel', () => ({
  useShellPanelOptional: () => ({ open: false, ownerKey: null, setPanel: mockSetPanel, closePanel: mockClosePanel }),
}));

// Narrow viewport for every render in this file.
vi.mock('../../../../hooks/useMediaQuery', () => ({
  useMediaQuery: () => true,
}));

import { StartWorkflowPage } from '../StartWorkflowPage';

function renderPage(initialEntries: string[] = ['/workflows/durable/invoke']) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={initialEntries}>
        <StartWorkflowPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  mockSetPanel.mockReset();
  mockClosePanel.mockReset();
});

describe('StartWorkflowPage — compact viewport', () => {
  it('folds the list into a select and never opens the shell panel', () => {
    renderPage();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByText('Choose a workflow to fill out its form.')).toBeInTheDocument();
    expect(screen.queryByText('Review user-generated content')).not.toBeInTheDocument();
    expect(mockSetPanel).not.toHaveBeenCalled();
  });

  it('selecting from the dropdown renders the form inline', () => {
    renderPage();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'processClaim' } });
    expect(screen.getByText('Process insurance claims')).toBeInTheDocument();
    expect(screen.getByText('Start Workflow')).toBeInTheDocument();
    expect(mockSetPanel).not.toHaveBeenCalled();
  });

  it('a ?type= deep link lands on the inline form', () => {
    renderPage(['/workflows/durable/invoke?type=reviewContent']);
    expect(screen.getByText('Review user-generated content')).toBeInTheDocument();
    expect(screen.getByText('Start Workflow')).toBeInTheDocument();
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('reviewContent');
  });
});
