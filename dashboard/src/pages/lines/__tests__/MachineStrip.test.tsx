import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MachineStrip, type StripMachine } from '../MachineStrip';
import { PRESENCE_DOT, presenceOf } from '../wire-display';
import type { MachineView } from '../../../api/machines';

function view(overrides: Partial<MachineView> = {}): MachineView {
  return {
    machineId: 'm1',
    process: 'press',
    role: 'press-line',
    address: 'addr-1',
    online: true,
    since: '2026-10-31T09:00:00.000Z',
    lastSeen: '2026-10-31T10:00:00.000Z',
    software: 'fw 2.1',
    bootId: 'b1',
    sessionId: 's1',
    heldUnits: [],
    rows: { handoff: 1, command: 0, alarm: 0, offlineRowId: null, quietRowId: null },
    alarms: [],
    jobs: [],
    ...overrides,
  };
}

function strip(machineId: string, v: MachineView | undefined): StripMachine {
  return { summary: { machineId, process: 'press', role: 'press-line', address: 'addr-1', addressing: 'declared' }, view: v };
}

function dotOf(machineId: string): HTMLElement {
  const tile = screen.getByText(machineId).closest('button')!;
  return tile.querySelector('.dot-ring') as HTMLElement;
}

describe('presenceOf', () => {
  it('reads online, quiet, offline and unknown from the view', () => {
    expect(presenceOf(view())).toBe('online');
    expect(presenceOf(view({ rows: { handoff: 0, command: 0, alarm: 0, offlineRowId: null, quietRowId: 'q1' } }))).toBe('quiet');
    expect(presenceOf(view({ online: false }))).toBe('offline');
    expect(presenceOf(view({ online: null }))).toBe('unknown');
    expect(presenceOf(undefined)).toBe('unknown');
  });
});

describe('MachineStrip', () => {
  it('colors the presence ring by tone', () => {
    render(
      <MachineStrip
        machines={[
          strip('m-online', view()),
          strip('m-quiet', view({ rows: { handoff: 0, command: 0, alarm: 0, offlineRowId: null, quietRowId: 'q1' } })),
          strip('m-offline', view({ online: false })),
          strip('m-unknown', undefined),
        ]}
        selectedId={null}
        onSelect={() => {}}
      />,
    );
    expect(dotOf('m-online')).toHaveClass(PRESENCE_DOT.online);
    expect(dotOf('m-quiet')).toHaveClass(PRESENCE_DOT.quiet);
    expect(dotOf('m-offline')).toHaveClass(PRESENCE_DOT.offline);
    expect(dotOf('m-unknown')).toHaveClass(PRESENCE_DOT.unknown);
    expect(screen.getByText('m-offline').closest('button')).toHaveAttribute('data-presence', 'offline');
  });

  it('shows software, held units, row counts and the alarm count in the warning tone', () => {
    render(
      <MachineStrip
        machines={[strip('m1', view({
          heldUnits: [{ unitId: 'U1', carrierId: null, rowId: 'r1' }],
          rows: { handoff: 2, command: 1, alarm: 1, offlineRowId: null, quietRowId: null },
          alarms: [{ alarmId: 'A1', level: 'high', raisedAt: '2026-10-31T10:00:00.000Z', rowId: 'r2' }],
        }))]}
        selectedId={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText('fw 2.1')).toBeInTheDocument();
    expect(screen.getByText('held 1')).toBeInTheDocument();
    expect(screen.getByText('h 2')).toBeInTheDocument();
    expect(screen.getByText('1 alarm')).toHaveClass('text-status-warning');
  });

  it('selects on click and marks the selected tile', () => {
    const onSelect = vi.fn();
    render(<MachineStrip machines={[strip('m1', view()), strip('m2', view())]} selectedId="m2" onSelect={onSelect} />);
    fireEvent.click(screen.getByText('m1'));
    expect(onSelect).toHaveBeenCalledWith('m1');
    expect(screen.getByText('m2').closest('button')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('m1').closest('button')).toHaveAttribute('aria-pressed', 'false');
  });
});
