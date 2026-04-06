import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../api/workflows', () => ({
  useActiveWorkers: vi.fn(),
}));

import { WorkersPage } from '../WorkersPage';
import { useActiveWorkers } from '../../../../api/workflows';
import type { ActiveWorker } from '../../../../api/types';

function makeWorker(overrides: Partial<ActiveWorker> = {}): ActiveWorker {
  return {
    name: 'reviewContent',
    task_queue: 'long-tail-examples',
    registered: false,
    system: false,
    ...overrides,
  };
}

const WORKERS: ActiveWorker[] = [
  makeWorker({ name: 'reviewContent', task_queue: 'long-tail-examples', registered: true }),
  makeWorker({ name: 'kitchenSink', task_queue: 'long-tail-examples', registered: true }),
  makeWorker({ name: 'basicEcho', task_queue: 'long-tail-examples', registered: false }),
  makeWorker({ name: 'customFlow', task_queue: 'user-queue', registered: false }),
];

function renderPage(initialPath = '/workflows/workers') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <WorkersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('WorkersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useActiveWorkers).mockReturnValue({
      data: WORKERS,
      isLoading: false,
    } as any);
  });

  // ── Rendering ──

  it('renders page header', () => {
    renderPage();
    expect(screen.getByText('Workers')).toBeInTheDocument();
  });

  it('renders all workers', () => {
    renderPage();
    expect(screen.getByText('reviewContent')).toBeInTheDocument();
    expect(screen.getByText('kitchenSink')).toBeInTheDocument();
    expect(screen.getByText('basicEcho')).toBeInTheDocument();
    expect(screen.getByText('customFlow')).toBeInTheDocument();
  });

  // ── Status badges ──

  it('renders Certified and Durable badges', () => {
    renderPage();
    expect(screen.getAllByText('Certified').length).toBe(2);
    expect(screen.getAllByText('Durable').length).toBe(2);
  });

  // ── Actions ──

  it('shows view icon for registered workers', () => {
    renderPage();
    const viewButtons = screen.getAllByTitle('View config');
    expect(viewButtons.length).toBe(2);
  });

  it('shows register icon for unregistered workers', () => {
    renderPage();
    const registerButtons = screen.getAllByTitle('Register workflow');
    expect(registerButtons.length).toBe(2);
  });

  // ── Loading ──

  it('renders loading skeleton when loading', () => {
    vi.mocked(useActiveWorkers).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as any);
    const { container } = renderPage();
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  // ── Empty state ──

  it('renders empty state when no workers', () => {
    vi.mocked(useActiveWorkers).mockReturnValue({
      data: [],
      isLoading: false,
    } as any);
    renderPage();
    expect(screen.getByText('No active workers')).toBeInTheDocument();
  });

  // ── Filter: Search ──

  it('filters by search text', async () => {
    vi.useFakeTimers();
    renderPage();
    const input = screen.getByPlaceholderText('Search workers...');
    fireEvent.change(input, { target: { value: 'kitchen' } });
    await act(() => vi.advanceTimersByTime(300));
    expect(screen.getByText('kitchenSink')).toBeInTheDocument();
    expect(screen.queryByText('reviewContent')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('search is case-insensitive', async () => {
    vi.useFakeTimers();
    renderPage();
    const input = screen.getByPlaceholderText('Search workers...');
    fireEvent.change(input, { target: { value: 'REVIEW' } });
    await act(() => vi.advanceTimersByTime(300));
    expect(screen.getByText('reviewContent')).toBeInTheDocument();
    vi.useRealTimers();
  });

  // ── Filter: Queue ──

  it('filters by queue', () => {
    renderPage();
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'user-queue' } });
    expect(screen.getByText('customFlow')).toBeInTheDocument();
    expect(screen.queryByText('reviewContent')).not.toBeInTheDocument();
  });

  it('derives queue options from data', () => {
    renderPage();
    const selects = screen.getAllByRole('combobox');
    const options = Array.from(selects[0].querySelectorAll('option')).map((o) => o.textContent);
    expect(options).toContain('All');
    expect(options).toContain('long-tail-examples');
    expect(options).toContain('user-queue');
  });

  it('clearing queue filter restores all results', () => {
    renderPage();
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'user-queue' } });
    expect(screen.queryByText('reviewContent')).not.toBeInTheDocument();
    fireEvent.change(selects[0], { target: { value: '' } });
    expect(screen.getByText('reviewContent')).toBeInTheDocument();
    expect(screen.getByText('customFlow')).toBeInTheDocument();
  });
});
