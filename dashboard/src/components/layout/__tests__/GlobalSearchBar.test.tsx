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

import { useSettings } from '../../../api/settings';
import { apiFetch } from '../../../api/client';
import { GlobalSearchBar, buildSearchTarget, BUILT_IN_SEARCH_FACETS } from '../GlobalSearchBar';

const mockSettings = vi.mocked(useSettings);
const mockFetch = vi.mocked(apiFetch);

const settings = (facets: string[]) => ({
  data: { search: { enabled: true, facets } },
} as unknown as ReturnType<typeof useSettings>);

function renderBar() {
  return render(<MemoryRouter><GlobalSearchBar /></MemoryRouter>);
}

async function search(facet: string, value: string) {
  fireEvent.change(screen.getByLabelText('Search facet'), { target: { value: facet } });
  fireEvent.change(screen.getByLabelText('Global search'), { target: { value } });
  fireEvent.keyDown(screen.getByLabelText('Global search'), { key: 'Enter' });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockSettings.mockReturnValue(settings(['orderId']));
});

describe('buildSearchTarget', () => {
  it('routes a metadata facet to the all-status table', () => {
    const url = buildSearchTarget('orderId', 'order-9')!;
    expect(url).toContain('/escalations/available');
    expect(url).toContain('status=all');
    expect(url).toContain(encodeURIComponent(JSON.stringify({ orderId: 'order-9' })));
  });

  it('defers built-in facets to a lookup', () => {
    expect(buildSearchTarget('escalationId', 'x')).toBeNull();
    expect(buildSearchTarget('workflowId', 'x')).toBeNull();
  });
});

describe('GlobalSearchBar', () => {
  it('prepends the built-in facets ahead of the configured list', () => {
    renderBar();
    const options = screen.getAllByRole('option').map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual([...BUILT_IN_SEARCH_FACETS, 'orderId']);
  });

  it('a facet search navigates to the filtered all-status list', async () => {
    renderBar();
    await search('orderId', 'order-9');
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining('status=all'));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('escalationId: found → detail', async () => {
    const id = '3f216994-7704-4e7a-9702-62130afaf9b0';
    mockFetch.mockResolvedValue({ id });
    renderBar();
    await search('escalationId', id);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/escalations/detail/${id}`));
  });

  it('escalationId: a non-UUID never costs a request — inline shape error', async () => {
    renderBar();
    await search('escalationId', 'Sample1 Jill Prinsen');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/not a valid escalation id/));
    expect(mockFetch).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('escalationId: not found → inline error, no navigation', async () => {
    mockFetch.mockRejectedValue(new Error('404'));
    renderBar();
    await search('escalationId', '00000000-0000-4000-8000-000000000000');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/No escalation/));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('workflowId: exactly one escalation → its detail', async () => {
    mockFetch.mockResolvedValue({ escalations: [{ id: 'esc-7', role: 'gluer', status: 'pending', type: 't' }] });
    renderBar();
    await search('workflowId', 'wf-1');
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/escalations/detail/esc-7'));
  });

  it('workflowId: several → picker with an execution link', async () => {
    mockFetch.mockResolvedValue({ escalations: [
      { id: 'a', role: 'gluer', status: 'pending', type: 't' },
      { id: 'b', role: 'finisher', status: 'resolved', type: 't' },
    ] });
    renderBar();
    await search('workflowId', 'wf-2');
    await waitFor(() => expect(screen.getByTestId('search-workflow-results')).toBeTruthy());
    expect(screen.getByText('Workflow execution →').getAttribute('href')).toBe('/workflows/executions/wf-2');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('workflowId: none → picker offers only the execution link', async () => {
    mockFetch.mockResolvedValue({ escalations: [] });
    renderBar();
    await search('workflowId', 'wf-3');
    await waitFor(() => expect(screen.getByText(/No escalations for this workflow/)).toBeTruthy());
    expect(screen.getByText('Workflow execution →').getAttribute('href')).toBe('/workflows/executions/wf-3');
  });

  it('remembers the last-used facet on this device', async () => {
    renderBar();
    fireEvent.change(screen.getByLabelText('Search facet'), { target: { value: 'orderId' } });
    expect(localStorage.getItem('lt:search:facet')).toBe('orderId');
  });
});
