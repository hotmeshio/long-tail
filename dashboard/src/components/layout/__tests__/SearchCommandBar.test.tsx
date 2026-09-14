import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));
vi.mock('../../../api/settings', () => ({ useSettings: vi.fn() }));
vi.mock('../../../api/client', () => ({ apiFetch: vi.fn() }));
vi.mock('../../../hooks/useScanInput', () => ({
  useScanEnabled: () => false,
  useScanInput: () => ({ submitCode: vi.fn(), busy: false, lastResult: null }),
}));
vi.mock('../../../hooks/useScanCommands', () => ({
  useScanCommands: () => ({ commands: [], loading: false }),
}));

import { useSettings } from '../../../api/settings';
import { apiFetch } from '../../../api/client';
import { SearchCommandBar } from '../SearchCommandBar';
import { BUILT_IN_SEARCH_FACETS, SEARCH_MODE_KEY } from '../../../lib/search-command';

const mockSettings = vi.mocked(useSettings);
const mockFetch = vi.mocked(apiFetch);

const settings = (facets: string[]) => ({
  data: { search: { enabled: true, facets } },
} as unknown as ReturnType<typeof useSettings>);

function renderBar() {
  return render(<MemoryRouter><SearchCommandBar /></MemoryRouter>);
}

function pickFacet(facet: string) {
  fireEvent.click(screen.getByTestId('search-mode'));
  fireEvent.click(screen.getByRole('option', { name: new RegExp(`^${facet}`) }));
}

function search(facet: string, value: string) {
  pickFacet(facet);
  fireEvent.change(screen.getByLabelText('Global search'), { target: { value } });
  fireEvent.keyDown(screen.getByLabelText('Global search'), { key: 'Enter' });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockSettings.mockReturnValue(settings(['orderId']));
});

describe('SearchCommandBar — Find modes', () => {
  it('offers the built-in facets ahead of the configured list', () => {
    renderBar();
    fireEvent.click(screen.getByTestId('search-mode'));
    const options = screen.getAllByRole('option').map((o) => o.textContent?.replace(/opens.*|filters.*/, ''));
    expect(options).toEqual([...BUILT_IN_SEARCH_FACETS, 'orderId']);
  });

  it('the type chip trails the input', () => {
    renderBar();
    const input = screen.getByLabelText('Global search');
    const chip = screen.getByTestId('search-mode');
    expect(input.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a facet search navigates to the filtered all-status list', () => {
    renderBar();
    search('orderId', 'order-9');
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining('status=all'));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('escalationId: found → detail', async () => {
    const id = '3f216994-7704-4e7a-9702-62130afaf9b0';
    mockFetch.mockResolvedValue({ id });
    renderBar();
    search('escalationId', id);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/escalations/detail/${id}`));
  });

  it('escalationId: a non-UUID never costs a request', async () => {
    renderBar();
    search('escalationId', 'Sample1 Jill Prinsen');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/not a valid escalation id/));
    expect(mockFetch).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('escalationId: not found → inline error, no navigation', async () => {
    mockFetch.mockRejectedValue(new Error('404'));
    renderBar();
    search('escalationId', '00000000-0000-4000-8000-000000000000');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/No escalation/));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('workflowId: exactly one escalation → its detail', async () => {
    mockFetch.mockResolvedValue({ escalations: [{ id: 'esc-7', role: 'gluer', status: 'pending', type: 't' }] });
    renderBar();
    search('workflowId', 'wf-1');
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/escalations/detail/esc-7'));
  });

  it('workflowId: several → picker with an execution link', async () => {
    mockFetch.mockResolvedValue({ escalations: [
      { id: 'a', role: 'gluer', status: 'pending', type: 't' },
      { id: 'b', role: 'finisher', status: 'resolved', type: 't' },
    ] });
    renderBar();
    search('workflowId', 'wf-2');
    await waitFor(() => expect(screen.getByTestId('search-workflow-results')).toBeTruthy());
    expect(screen.getByText('Workflow execution →').getAttribute('href')).toBe('/workflows/executions/wf-2');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('workflowId: none → picker offers only the execution link', async () => {
    mockFetch.mockResolvedValue({ escalations: [] });
    renderBar();
    search('workflowId', 'wf-3');
    await waitFor(() => expect(screen.getByText(/No escalations for this workflow/)).toBeTruthy());
    expect(screen.getByText('Workflow execution →').getAttribute('href')).toBe('/workflows/executions/wf-3');
  });

  it('remembers the last-used mode on this device and honors the legacy facet key', () => {
    localStorage.setItem('lt:search:facet', 'orderId');
    renderBar();
    expect(screen.getByTestId('search-mode').textContent).toBe('orderId');
    pickFacet('workflowId');
    expect(JSON.parse(localStorage.getItem(SEARCH_MODE_KEY)!)).toEqual({ kind: 'facet', facet: 'workflowId' });
    expect(screen.getByLabelText('Global search').getAttribute('placeholder')).toBe('Workflow id');
  });

  it('renders nothing when search is off and scan input is off', () => {
    mockSettings.mockReturnValue({ data: { search: { enabled: false, facets: [] } } } as unknown as ReturnType<typeof useSettings>);
    renderBar();
    expect(screen.queryByTestId('global-search')).toBeNull();
  });
});
