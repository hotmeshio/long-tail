import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  access: { isBuilder: false, isOps: true, canBulk: true, canAdminister: true },
  setPanel: vi.fn(),
  closePanel: vi.fn(),
}));

vi.mock('../../../api/client', async (io) => ({
  ...(await io<typeof import('../../../api/client')>()),
  apiFetch: mocks.apiFetch,
}));
vi.mock('../../../hooks/useAccess', () => ({ useAccess: () => mocks.access }));
vi.mock('../../../hooks/useShellPanel', async (io) => ({
  ...(await io<typeof import('../../../hooks/useShellPanel')>()),
  useShellPanelOptional: () => ({ setPanel: mocks.setPanel, closePanel: mocks.closePanel, open: false, ownerKey: null, node: null, width: 0 }),
}));

import { LinesPage } from '../LinesPage';
import { ApiError } from '../../../api/client';
import type { LineIndex, LineIndexRow } from '../../../api/machines';

function line(siteId: string, lineId: string, patch: Partial<LineIndexRow> = {}): LineIndexRow {
  return {
    siteId, lineId, leading: true, source: 'code', version: 2, enabled: true, updatedAt: '2026-10-31T10:00:00.000Z',
    machines: [
      { machineId: 'print-01', process: 'print', role: 'line-print', address: 'print-01', addressing: 'declared' },
      { machineId: 'press-01', process: 'bond', role: 'line-bond', address: 'press-01', addressing: 'declared' },
    ],
    health: { machines: 2, offline: 0, quiet: 0, alarms: 0, people: 0, handoff: 0, command: 0, attention: false },
    ...patch,
  };
}

function index(lines: LineIndexRow[]): LineIndex {
  const sites = [...new Set(lines.map((l) => l.siteId))].map((siteId) => ({
    siteId, lines: lines.filter((l) => l.siteId === siteId).length, attention: lines.filter((l) => l.siteId === siteId && l.health.attention).length,
  }));
  return { lines, total: lines.length, sites, limit: 50, offset: 0, declared: true };
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/lines']}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mocks.apiFetch.mockReset();
  mocks.setPanel.mockReset();
  mocks.access.isOps = true;
  mocks.access.isBuilder = false;
  mocks.access.canAdminister = true;
});

describe('LinesPage', () => {
  it('groups lines under their site with counts and tones', async () => {
    const trouble = line('north', 'line-2', { leading: false, health: { machines: 3, offline: 1, quiet: 0, alarms: 2, people: 1, handoff: 4, command: 1, attention: true } });
    mocks.apiFetch.mockResolvedValue(index([line('north', 'line-1'), trouble, line('south', 'line-1')]));
    render(<LinesPage />, { wrapper });
    await waitFor(() => expect(screen.getAllByTestId('site-heading')).toHaveLength(2));
    const north = screen.getByRole('region', { name: 'north' });
    expect(within(north).getByText('2 lines')).toBeInTheDocument();
    expect(within(north).getByText('1 needs attention')).toBeInTheDocument();
    const row = within(north).getByText('north · line-2').closest('tr')!;
    expect(within(row).getByTitle('needs attention')).toBeInTheDocument();
    expect(within(row).getByText(/1 offline/)).toHaveClass('text-status-warning');
    expect(within(row).getByTitle('Active alarms')).toHaveTextContent('2');
    expect(within(row).getByTitle('Rows waiting on a person')).toHaveTextContent('1');
    expect(within(row).getByTitle('Open handoff and command rows')).toHaveTextContent('5');
    expect(within(row).getByText('elsewhere')).toBeInTheDocument();
    expect(screen.getByText('3 lines')).toBeInTheDocument();
    expect(mocks.apiFetch).toHaveBeenCalledWith(expect.stringContaining('/machines/lines?sort=attention&limit=50&offset=0'));
  });

  it('tells an undeclared surface apart from a page that matches nothing', async () => {
    mocks.apiFetch.mockRejectedValue(new ApiError('no machine lines are declared', 404, {}));
    const { unmount } = render(<LinesPage />, { wrapper });
    await waitFor(() => expect(screen.getByText('Lines appear here once the server declares them.')).toBeInTheDocument());
    unmount();
    mocks.apiFetch.mockResolvedValue({ ...index([]), sites: [{ siteId: 'north', lines: 1, attention: 0 }] });
    render(<LinesPage />, { wrapper });
    await waitFor(() => expect(screen.getByText('No lines declared yet.')).toBeInTheDocument());
  });

  it('sends the search, site and attention filters to the server and stops grouping', async () => {
    mocks.apiFetch.mockResolvedValue(index([line('north', 'line-1')]));
    render(<LinesPage />, { wrapper });
    await waitFor(() => expect(screen.getByText('north · line-1')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Needs attention' }));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenLastCalledWith(expect.stringContaining('attention=true')));
    fireEvent.change(screen.getByDisplayValue('every site'), { target: { value: 'north' } });
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenLastCalledWith(expect.stringContaining('site=north')));
    await waitFor(() => expect(screen.queryByTestId('site-heading')).not.toBeInTheDocument());
  });

  it('offers the declare panel to ops and opens it prefilled from a row', async () => {
    mocks.apiFetch.mockResolvedValue(index([line('north', 'line-1')]));
    render(<LinesPage />, { wrapper });
    await waitFor(() => expect(screen.getByText('north · line-1')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Declare line' }));
    expect(mocks.setPanel).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ key: 'line-declare' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit north · line-1' }));
    expect(mocks.setPanel).toHaveBeenCalledTimes(2);
  });

  it('keeps the declare tools from operators', async () => {
    mocks.access.isOps = true;
    mocks.access.canAdminister = false;
    mocks.apiFetch.mockResolvedValue(index([line('north', 'line-1')]));
    render(<LinesPage />, { wrapper });
    await waitFor(() => expect(screen.getByText('north · line-1')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Declare line' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument();
  });
});
