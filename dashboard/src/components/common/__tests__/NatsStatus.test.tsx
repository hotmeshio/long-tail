import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NatsStatus } from '../display/NatsStatus';

// Mock the useNats hook so we can control the connected state
vi.mock('../../../hooks/useNats', () => ({
  useNatsStatus: vi.fn(),
}));

import { useNatsStatus } from '../../../hooks/useNats';
const mockUseNatsStatus = useNatsStatus as ReturnType<typeof vi.fn>;

describe('NatsStatus', () => {
  it('renders green dot when connected', () => {
    mockUseNatsStatus.mockReturnValue({ connected: true });

    render(<NatsStatus />);

    const dot = screen.getByTestId('nats-status-dot');
    expect(dot.className).toContain('bg-emerald-500');
  });

  it('renders gray dot when disconnected', () => {
    mockUseNatsStatus.mockReturnValue({ connected: false });

    render(<NatsStatus />);

    const dot = screen.getByTestId('nats-status-dot');
    expect(dot.className).toContain('bg-text-tertiary');
  });

  it('sets correct title attribute when connected', () => {
    mockUseNatsStatus.mockReturnValue({ connected: true });

    render(<NatsStatus />);

    expect(screen.getByTitle('Live events enabled')).toBeInTheDocument();
  });

  it('sets correct title attribute when disconnected', () => {
    mockUseNatsStatus.mockReturnValue({ connected: false });

    render(<NatsStatus />);

    expect(screen.getByTitle('Live events disconnected')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    mockUseNatsStatus.mockReturnValue({ connected: true });

    const { container } = render(<NatsStatus className="ml-4" />);

    const button = container.firstElementChild;
    expect(button?.className).toContain('ml-4');
  });
});
