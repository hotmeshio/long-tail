import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NatsStatus } from '../NatsStatus';

// Mock the useNats hook so we can control the connected state
vi.mock('../../../hooks/useNats', () => ({
  useNatsStatus: vi.fn(),
}));

import { useNatsStatus } from '../../../hooks/useNats';
const mockUseNatsStatus = useNatsStatus as ReturnType<typeof vi.fn>;

describe('NatsStatus', () => {
  it('renders "Live" with green dot when connected', () => {
    mockUseNatsStatus.mockReturnValue({ connected: true });

    render(<NatsStatus />);

    expect(screen.getByText('Live')).toBeInTheDocument();
    const dot = screen.getByTestId('nats-status-dot');
    expect(dot.className).toContain('bg-emerald-500');
  });

  it('renders "Offline" with gray dot when disconnected', () => {
    mockUseNatsStatus.mockReturnValue({ connected: false });

    render(<NatsStatus />);

    expect(screen.getByText('Offline')).toBeInTheDocument();
    const dot = screen.getByTestId('nats-status-dot');
    expect(dot.className).toContain('bg-text-tertiary');
  });

  it('sets correct title attribute when connected', () => {
    mockUseNatsStatus.mockReturnValue({ connected: true });

    render(<NatsStatus />);

    expect(screen.getByTitle('Live updates connected')).toBeInTheDocument();
  });

  it('sets correct title attribute when disconnected', () => {
    mockUseNatsStatus.mockReturnValue({ connected: false });

    render(<NatsStatus />);

    expect(screen.getByTitle('Live updates disconnected')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    mockUseNatsStatus.mockReturnValue({ connected: true });

    const { container } = render(<NatsStatus className="ml-4" />);

    const span = container.firstElementChild;
    expect(span?.className).toContain('ml-4');
  });
});
