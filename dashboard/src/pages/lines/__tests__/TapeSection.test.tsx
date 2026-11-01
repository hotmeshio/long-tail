import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TapeSection, TAPE_BOX_CLASS, type TapeSectionProps } from '../TapeSection';
import { EMPTY_FILTERS } from '../../../hooks/useWireTape';
import type { WireEvent } from '../../../api/machines';

const event: WireEvent = {
  type: 'machine.wire', siteId: 'acme', lineId: 'l1', machineId: 'm1', address: 'm1', direction: 'in', channel: 'job',
  topic: 'acme/l1/m1/job', id: 'msg-1', at: '2026-10-31T10:02:07.000Z', retained: false, kind: 'job', event: 'arrived',
  summary: 'job arrived U1', violations: [], actions: [],
};

function props(overrides: Partial<TapeSectionProps> = {}): TapeSectionProps {
  return {
    events: [event], total: 1, paused: false, heldCount: 0, filters: EMPTY_FILTERS, machines: ['m1'], channels: ['job'],
    setFilter: vi.fn(), togglePause: vi.fn(), clear: vi.fn(), onOpen: vi.fn(),
    fullscreen: false, onFullscreen: vi.fn(), watching: false, onWatch: vi.fn(),
    ...overrides,
  };
}

describe('TapeSection', () => {
  it('is a box of its own with the list scrolling inside', () => {
    render(<TapeSection {...props()} />);
    const box = screen.getByRole('region', { name: 'Wire tape' });
    expect(box.className).toBe(TAPE_BOX_CLASS);
    expect(screen.getByRole('list', { name: 'Wire tape' })).toHaveClass('overflow-y-auto');
  });

  it('opens the tape full screen in the overlay', () => {
    const p = props();
    const { rerender } = render(<TapeSection {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
    expect(p.onFullscreen).toHaveBeenCalledWith(true);
    rerender(<TapeSection {...p} fullscreen />);
    expect(screen.getAllByRole('list', { name: 'Wire tape' })).toHaveLength(2);
    expect(screen.getByTitle('Close (Esc)')).toBeInTheDocument();
  });

  it('shows the followed machine as a chip that releases the filter', () => {
    const p = props({ filters: { ...EMPTY_FILTERS, machine: 'm1' } });
    render(<TapeSection {...p} />);
    fireEvent.click(screen.getByRole('button', { name: /m1 release/ }));
    expect(p.setFilter).toHaveBeenCalledWith({ machine: null });
  });

  it('offers to watch the line on the event stream, and says when it already does', () => {
    const p = props();
    const { rerender } = render(<TapeSection {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Watch on the event stream' }));
    expect(p.onWatch).toHaveBeenCalled();
    rerender(<TapeSection {...p} watching />);
    expect(screen.getByRole('button', { name: 'Watching' })).toBeDisabled();
  });
});
