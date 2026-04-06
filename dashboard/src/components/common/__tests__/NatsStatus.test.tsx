import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NatsStatus } from '../display/NatsStatus';

vi.mock('../../../hooks/useEventContext', () => ({
  useEventStatus: vi.fn(),
}));

import { useEventStatus } from '../../../hooks/useEventContext';
const mockUseEventStatus = useEventStatus as ReturnType<typeof vi.fn>;

describe('NatsStatus', () => {
  it('renders green dot when connected', () => {
    mockUseEventStatus.mockReturnValue({ connected: true });

    render(<NatsStatus />);

    const dot = screen.getByTestId('nats-status-dot');
    expect(dot.className).toContain('bg-emerald-500');
  });

  it('renders gray dot when disconnected', () => {
    mockUseEventStatus.mockReturnValue({ connected: false });

    render(<NatsStatus />);

    const dot = screen.getByTestId('nats-status-dot');
    expect(dot.className).toContain('bg-text-tertiary');
  });

  it('sets correct title attribute when connected', () => {
    mockUseEventStatus.mockReturnValue({ connected: true });

    render(<NatsStatus />);

    expect(screen.getByTitle('Live events enabled')).toBeInTheDocument();
  });

  it('sets correct title attribute when disconnected', () => {
    mockUseEventStatus.mockReturnValue({ connected: false });

    render(<NatsStatus />);

    expect(screen.getByTitle('Live events disconnected')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    mockUseEventStatus.mockReturnValue({ connected: true });

    const { container } = render(<NatsStatus className="ml-4" />);

    const button = container.firstElementChild;
    expect(button?.className).toContain('ml-4');
  });
});
