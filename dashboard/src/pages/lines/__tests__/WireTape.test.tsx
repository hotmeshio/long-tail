import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { WireTape, type WireTapeProps } from '../WireTape';
import { EMPTY_FILTERS } from '../../../hooks/useWireTape';
import type { WireEvent } from '../../../api/machines';

const event: WireEvent = {
  type: 'machine.wire',
  siteId: 'acme',
  lineId: 'l1',
  machineId: 'm1',
  address: 'addr-1',
  direction: 'in',
  channel: 'job',
  topic: 'acme/l1/m1/job',
  id: 'msg-1',
  at: '2026-10-31T10:02:07.000Z',
  retained: false,
  kind: 'job',
  event: 'arrived',
  summary: 'job arrived U1',
  violations: ['carrier unknown'],
  actions: [{ verb: 'accumulate', rowId: 'row-3', itemKey: 'arrived:U1' }, { verb: 'none' }],
};

function props(overrides: Partial<WireTapeProps> = {}): WireTapeProps {
  return {
    events: [event],
    total: 1,
    paused: false,
    heldCount: 0,
    filters: EMPTY_FILTERS,
    machines: ['m1'],
    channels: ['job'],
    setFilter: vi.fn(),
    togglePause: vi.fn(),
    clear: vi.fn(),
    onOpen: vi.fn(),
    ...overrides,
  };
}

describe('WireTape', () => {
  it('renders a row from a wire event', () => {
    const p = props();
    render(<WireTape {...p} />);
    const row = screen.getByText('job arrived U1').closest('button')!;
    expect(row).toHaveAttribute('data-direction', 'in');
    expect(row).toHaveAttribute('data-kind', 'job');
    expect(within(row).getByText('m1')).toBeInTheDocument();
    expect(within(row).getByTitle('job acme/l1/m1/job')).toBeInTheDocument();
    expect(screen.getByText('1 violation')).toHaveClass('text-status-warning');
    expect(screen.getByText('accumulated arrived:U1')).toBeInTheDocument();
    expect(screen.getByText('1 shown · 1 on tape')).toBeInTheDocument();
    fireEvent.click(row);
    expect(p.onOpen).toHaveBeenCalledWith(event);
  });

  it('drives the filters and the pause through the callbacks', () => {
    const p = props();
    render(<WireTape {...p} />);
    fireEvent.change(screen.getByDisplayValue('every machine'), { target: { value: 'm1' } });
    expect(p.setFilter).toHaveBeenCalledWith({ machine: 'm1' });
    fireEvent.click(screen.getByRole('button', { name: 'Violations only' }));
    expect(p.setFilter).toHaveBeenCalledWith({ violationsOnly: true });
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(p.togglePause).toHaveBeenCalled();
  });

  it('says how many events wait while paused', () => {
    render(<WireTape {...props({ paused: true, heldCount: 12 })} />);
    expect(screen.getByRole('button', { name: 'Resume · 12 held' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('tells an empty tape apart from a fully filtered one', () => {
    const { rerender } = render(<WireTape {...props({ events: [], total: 0 })} />);
    expect(screen.getByText('Waiting for traffic on the wire.')).toBeInTheDocument();
    rerender(<WireTape {...props({ events: [], total: 4 })} />);
    expect(screen.getByText('Every event on the tape is filtered out.')).toBeInTheDocument();
  });
});
