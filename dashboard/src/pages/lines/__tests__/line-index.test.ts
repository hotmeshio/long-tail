import { describe, it, expect } from 'vitest';
import type { LineIndexRow } from '../../../api/machines';
import { definitionOf, groupBySite, lineTone, parseDefinition } from '../line-index';

function row(siteId: string, lineId: string, patch: Partial<LineIndexRow['health']> = {}, leading = false): LineIndexRow {
  return {
    siteId, lineId, leading, source: 'code', version: 1, enabled: true, updatedAt: '2026-10-31T10:00:00.000Z',
    machines: [{ machineId: 'm1', process: 'print', role: 'line-print', address: 'm1', addressing: 'declared' }],
    health: { machines: 1, offline: 0, quiet: 0, alarms: 0, people: 0, handoff: 0, command: 0, attention: false, ...patch },
  };
}

describe('lineTone', () => {
  it('reads attention first, then work or a leader, then idle', () => {
    expect(lineTone(row('s', 'a', { attention: true, alarms: 1 }))).toBe('attention');
    expect(lineTone(row('s', 'b', {}, true))).toBe('running');
    expect(lineTone(row('s', 'c', { handoff: 2 }))).toBe('running');
    expect(lineTone(row('s', 'd'))).toBe('idle');
  });
});

describe('groupBySite', () => {
  it('keeps page order and counts attention per site', () => {
    const groups = groupBySite([row('north', 'l1', { attention: true }), row('south', 'l1'), row('north', 'l2')]);
    expect(groups.map((g) => g.siteId)).toEqual(['north', 'south']);
    expect(groups[0].lines.map((l) => l.lineId)).toEqual(['l1', 'l2']);
    expect(groups[0].attention).toBe(1);
    expect(groups[1].attention).toBe(0);
  });
});

describe('parseDefinition', () => {
  it('names what a definition is missing', () => {
    expect(parseDefinition('{')).toMatchObject({ ok: false });
    expect(parseDefinition('[]')).toMatchObject({ ok: false, message: 'The definition must be an object.' });
    expect(parseDefinition('{"lineId":"l"}')).toMatchObject({ ok: false, message: 'siteId is required.' });
    expect(parseDefinition('{"siteId":"s","lineId":"l","machines":[]}')).toMatchObject({ ok: false });
    expect(parseDefinition('{"siteId":"s","lineId":"l","machines":[{"machineId":"m"}]}')).toMatchObject({ ok: false });
  });

  it('accepts a line with machines that name a process', () => {
    const parsed = parseDefinition('{"siteId":"s","lineId":"l","machines":[{"machineId":"m","process":"print","cycleSec":3}]}');
    expect(parsed.ok).toBe(true);
  });

  it('rebuilds a definition from a row, keeping declared addresses', () => {
    const def = definitionOf({ ...row('s', 'l'), machines: [{ machineId: 'm1', process: 'print', role: 'r', address: 'addr-1', addressing: 'declared' }] });
    expect(def).toEqual({ siteId: 's', lineId: 'l', machines: [{ machineId: 'm1', process: 'print', address: 'addr-1' }] });
  });
});
