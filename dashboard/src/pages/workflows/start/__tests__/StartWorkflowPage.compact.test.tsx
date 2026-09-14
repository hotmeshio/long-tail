import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { REVIEW, CLAIM } from './invoke-test-data';

// Below xl the list folds into a grouped select and the form takes the full width.
vi.mock('../../../../api/workflows', () => ({
  useInvocableWorkflows: () => ({ data: [REVIEW, CLAIM], isLoading: false }),
  useCronStatus: () => ({ data: [] }),
  useInvokeWorkflow: () => ({ mutateAsync: vi.fn(), isPending: false, isSuccess: false, error: null, reset: vi.fn() }),
  useWorkflowLookups: () => ({ data: undefined }),
  foldWorkflowLookups: () => ({}),
}));
vi.mock('../../../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { username: 'testuser' }, isSuperAdmin: false, hasRoleType: () => false }),
}));
vi.mock('../../../../hooks/useAccess', () => ({ useAccess: () => ({ realIsBuilder: false }) }));
vi.mock('../../../../api/bots', () => ({ useBots: () => ({ data: { bots: [] } }) }));
vi.mock('../../../../hooks/useMediaQuery', () => ({ useMediaQuery: () => true }));

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

describe('StartWorkflowPage — compact viewport', () => {
  it('folds the list into a select with the first workflow preselected', () => {
    renderPage();
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('processClaim');
    expect(screen.queryByTestId('invoke-list')).not.toBeInTheDocument();
    expect(screen.getByText('Process insurance claims')).toBeInTheDocument();
  });

  it('selecting from the dropdown renders that form inline', () => {
    renderPage();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'reviewContent' } });
    expect(screen.getByText('Review user-generated content')).toBeInTheDocument();
    expect(screen.getByTestId('invoke-start')).toBeInTheDocument();
  });

  it('a ?type= deep link lands on the inline form', () => {
    renderPage(['/workflows/durable/invoke?type=reviewContent']);
    expect(screen.getByText('Review user-generated content')).toBeInTheDocument();
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('reviewContent');
  });
});
