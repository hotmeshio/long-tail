import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

vi.mock('../../../api/tasks', () => ({
  useProcesses: vi.fn(),
}));

import { ProcessesOverview } from '../ProcessesOverview';
import { useProcesses } from '../../../api/tasks';

const mockProcesses = {
  processes: [
    {
      origin_id: 'process-001',
      task_count: 3,
      completed: 2,
      escalated: 1,
      workflow_types: ['reviewContent'],
      started_at: '2026-01-15T10:00:00Z',
      last_activity: '2026-01-15T11:30:00Z',
    },
    {
      origin_id: 'process-002',
      task_count: 1,
      completed: 1,
      escalated: 0,
      workflow_types: ['reviewContent', 'verifyDocument'],
      started_at: '2026-01-14T08:00:00Z',
      last_activity: '2026-01-14T08:05:00Z',
    },
  ],
  total: 2,
};

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('ProcessesOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders stat cards with data', () => {
    vi.mocked(useProcesses).mockReturnValue({
      data: mockProcesses,
      isLoading: false,
    } as any);

    renderWithRouter(<ProcessesOverview />);

    expect(screen.getByText('Business Processes')).toBeInTheDocument();
    expect(screen.getByText('Total Processes')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Escalated')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders dash placeholders when loading', () => {
    vi.mocked(useProcesses).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as any);

    renderWithRouter(<ProcessesOverview />);

    const dashes = screen.getAllByText('—');
    expect(dashes).toHaveLength(4);
  });

  it('renders all four stat cards', () => {
    vi.mocked(useProcesses).mockReturnValue({
      data: mockProcesses,
      isLoading: false,
    } as any);

    renderWithRouter(<ProcessesOverview />);

    expect(screen.getByText('Total Processes')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Escalated')).toBeInTheDocument();
  });
});
