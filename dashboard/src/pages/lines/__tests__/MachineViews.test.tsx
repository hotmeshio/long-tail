import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MachineViews } from '../MachineViews';
import type { StripMachine } from '../MachineStrip';
import type { MachineView } from '../../../api/machines';

function view(overrides: Partial<MachineView> = {}): MachineView {
  return {
    machineId: 'm1', process: 'press', role: 'line-press', address: 'm1', online: true, since: null, lastSeen: null,
    software: 'fw 1', bootId: null, sessionId: null, heldUnits: [],
    rows: { handoff: 0, command: 0, alarm: 0, offlineRowId: null, quietRowId: null }, alarms: [], jobs: [],
    ...overrides,
  };
}

function machine(machineId: string, process = 'press', v: MachineView | undefined = view({ machineId })): StripMachine {
  return { summary: { machineId, process, role: `line-${process}`, address: machineId, addressing: 'declared' }, view: v };
}

const alarmed = machine('press-02', 'press', view({ machineId: 'press-02', alarms: [{ alarmId: 'A1', level: 'high', raisedAt: '', rowId: null }] }));

function renderViews(overrides: Partial<Parameters<typeof MachineViews>[0]> = {}) {
  const props = {
    machines: [machine('print-01', 'print'), alarmed, machine('cut-01', 'trim')],
    selectedId: null,
    onSelect: vi.fn(),
    view: 'tiles' as const,
    onView: vi.fn(),
    attentionOnly: false,
    onAttentionOnly: vi.fn(),
    ...overrides,
  };
  render(<MachineViews {...props} />);
  return props;
}

describe('MachineViews', () => {
  it('offers tiles and rows as a radio set and reports the one chosen', () => {
    const p = renderViews();
    fireEvent.click(screen.getByRole('radio', { name: 'Rows' }));
    expect(p.onView).toHaveBeenCalledWith('rows');
    expect(screen.getByRole('radio', { name: 'Tiles' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.getByText(/1 needs attention/)).toHaveClass('text-status-warning');
  });

  it('keeps only the machines that need attention when asked', () => {
    renderViews({ attentionOnly: true, view: 'rows' });
    const list = screen.getByRole('list', { name: 'Machines' });
    expect(within(list).getByText('press-02')).toBeInTheDocument();
    expect(within(list).queryByText('print-01')).not.toBeInTheDocument();
  });

  it('rows: the search narrows by id, process or address', () => {
    renderViews({ view: 'rows' });
    fireEvent.change(screen.getByLabelText('Find a machine'), { target: { value: 'trim' } });
    const list = screen.getByRole('list', { name: 'Machines' });
    expect(within(list).getByText('cut-01')).toBeInTheDocument();
    expect(within(list).queryByText('print-01')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
  });

});
