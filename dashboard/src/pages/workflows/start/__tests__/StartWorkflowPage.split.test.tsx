import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation, createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { REVIEW, CLAIM } from './invoke-test-data';

// The 25/75 split: the form lives in the page, selection lives in ?type=.
vi.mock('../../../../api/workflows', () => ({
  useInvocableWorkflows: () => ({ data: [REVIEW, CLAIM], isLoading: false }),
  useCronStatus: () => ({ data: [] }),
  useInvokeWorkflow: () => ({ mutateAsync: vi.fn(), isPending: false, isSuccess: false, error: null, reset: vi.fn() }),
}));
vi.mock('../../../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { username: 'testuser' }, isSuperAdmin: false, hasRoleType: () => false }),
}));
vi.mock('../../../../hooks/useAccess', () => ({ useAccess: () => ({ realIsBuilder: false }) }));
vi.mock('../../../../api/bots', () => ({ useBots: () => ({ data: { bots: [] } }) }));
vi.mock('../../../../hooks/useMediaQuery', () => ({ useMediaQuery: () => false }));

const mockSetPanel = vi.fn();
vi.mock('../../../../hooks/useShellPanel', () => ({
  useShellPanelOptional: () => ({ open: false, ownerKey: null, setPanel: mockSetPanel, closePanel: vi.fn() }),
}));

import { StartWorkflowPage } from '../StartWorkflowPage';

function Location() {
  const loc = useLocation();
  return <output data-testid="location">{loc.search}</output>;
}

function renderPage(initialEntries = ['/workflows/durable/invoke']) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={initialEntries}>
        <StartWorkflowPage />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderWithRouter() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [{ path: '/workflows/durable/invoke', element: <StartWorkflowPage /> }],
    { initialEntries: ['/workflows/durable/invoke'] },
  );
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
}

describe('StartWorkflowPage — list beside form', () => {
  it('each choice is a history entry; the opening preselect is not', async () => {
    const router = renderWithRouter();
    expect(router.state.location.search).toBe('?type=processClaim');
    fireEvent.click(screen.getByRole('button', { name: /Review Content/ }));
    expect(router.state.location.search).toBe('?type=reviewContent');
    fireEvent.click(screen.getByRole('button', { name: /Process Claim/ }));
    expect(router.state.location.search).toBe('?type=processClaim');

    await router.navigate(-1);
    expect(router.state.location.search).toBe('?type=reviewContent');
    await router.navigate(-1);
    expect(router.state.location.search).toBe('?type=processClaim');
    // The landing URL was rewritten in place: one more step back leaves the page's history entirely.
    expect(router.state.historyAction).toBe('POP');
  });

  it('writes the preselected workflow into ?type= and never opens the shell slot', () => {
    renderPage();
    expect(screen.getByTestId('location')).toHaveTextContent('?type=processClaim');
    expect(screen.getByTestId('invoke-form')).toBeInTheDocument();
    expect(mockSetPanel).not.toHaveBeenCalled();
  });

  it('clicking a row swaps the form in place', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Review Content/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('?type=reviewContent');
    expect(screen.getByText('Review user-generated content')).toBeInTheDocument();
    expect(screen.queryByText('Process insurance claims')).not.toBeInTheDocument();
  });

  it('the list column sits before the form column', () => {
    renderPage();
    const list = screen.getByTestId('invoke-list');
    const form = screen.getByTestId('invoke-form');
    expect(list.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the list filters stay hidden until scale demands them', () => {
    renderPage();
    expect(screen.queryByPlaceholderText(/workflows…/)).not.toBeInTheDocument();
    expect(screen.queryByText('Queue')).not.toBeInTheDocument();
  });
});
