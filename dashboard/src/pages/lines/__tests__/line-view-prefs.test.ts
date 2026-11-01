import { describe, it, expect, beforeEach } from 'vitest';
import {
  autoMachineView,
  needsAttention,
  readStored,
  writeStored,
  MACHINE_VIEWS,
  TILES_MAX,
} from '../line-view-prefs';
import type { MachineView } from '../../../api/machines';

function view(overrides: Partial<MachineView> = {}): MachineView {
  return {
    machineId: 'm1', process: 'press', role: 'line-press', address: 'm1', online: true, since: null, lastSeen: null,
    software: null, bootId: null, sessionId: null, heldUnits: [],
    rows: { handoff: 0, command: 0, alarm: 0, offlineRowId: null, quietRowId: null }, alarms: [], jobs: [],
    ...overrides,
  };
}

beforeEach(() => localStorage.clear());

describe('autoMachineView', () => {
  it('picks tiles to a dozen machines, rows beyond', () => {
    expect(autoMachineView(1)).toBe('tiles');
    expect(autoMachineView(TILES_MAX)).toBe('tiles');
    expect(autoMachineView(TILES_MAX + 1)).toBe('rows');
    expect(autoMachineView(400)).toBe('rows');
  });
});

describe('stored choices', () => {
  it('round-trips an allowed value and ignores anything else', () => {
    writeStored('k', 'rows');
    expect(readStored('k', MACHINE_VIEWS)).toBe('rows');
    writeStored('k', 'bogus');
    expect(readStored('k', MACHINE_VIEWS)).toBeNull();
    writeStored('k', null);
    expect(localStorage.getItem('k')).toBeNull();
  });
});

describe('needsAttention', () => {
  it('is quiet for an online machine with nothing open', () => {
    expect(needsAttention(view())).toBe(false);
    expect(needsAttention(undefined)).toBe(false);
  });

  it('flags offline, quiet, alarms and open rows', () => {
    expect(needsAttention(view({ online: false }))).toBe(true);
    expect(needsAttention(view({ rows: { handoff: 0, command: 0, alarm: 0, offlineRowId: null, quietRowId: 'q' } }))).toBe(true);
    expect(needsAttention(view({ alarms: [{ alarmId: 'A', level: 'high', raisedAt: '', rowId: null }] }))).toBe(true);
    expect(needsAttention(view({ rows: { handoff: 1, command: 0, alarm: 0, offlineRowId: null, quietRowId: null } }))).toBe(true);
  });
});
