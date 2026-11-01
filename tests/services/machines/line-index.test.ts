import { describe, it, expect } from 'vitest';

import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { emptyLineHealth, lineSummaryOf, toLineIndexRow, wirePayloadOf } from '../../../services/machines/line-index';
import { summarizeLine, type LineSurface } from '../../../services/machines/surface';
import type { LineRecordWithHealth } from '../../../services/machines/registry';

const { siteId, lineId } = DEFAULT_LINE;

function surface(opts: { runs: boolean; leads: boolean }): LineSurface {
  return {
    describeLines: () => (opts.runs ? [summarizeLine(DEFAULT_LINE, { rowOps: ['probe'] })] : []),
    describeLine: () => (opts.leads ? ({ siteId, lineId, leading: true, takenAt: null, machines: [], contested: [] }) : null),
    inspect: () => null,
    findLine: (s, l) => (opts.runs && s === siteId && l === lineId ? DEFAULT_LINE : undefined),
    commandOps: () => [],
  };
}

function record(): LineRecordWithHealth {
  return {
    siteId, lineId, definition: DEFAULT_LINE, source: 'api', version: 3, enabled: true,
    createdAt: '2026-10-31T00:00:00.000Z', updatedAt: '2026-10-31T01:00:00.000Z', health: emptyLineHealth(3),
  };
}

describe('line index helpers', () => {
  it('describes a running line from the surface, with the codec ops', () => {
    expect(lineSummaryOf(surface({ runs: true, leads: true }), siteId, lineId, DEFAULT_LINE).machines[0].rowOps).toEqual(['probe']);
  });

  it('describes a line this replica does not run from the stored definition', () => {
    const summary = lineSummaryOf(surface({ runs: false, leads: false }), siteId, lineId, DEFAULT_LINE);
    expect(summary.machines.map((m) => m.machineId)).toEqual(DEFAULT_LINE.machines.map((m) => m.machineId));
    expect(summary.machines[0].rowOps).toBeUndefined();
  });

  it('joins the row with whether this replica leads it', () => {
    expect(toLineIndexRow(surface({ runs: true, leads: true }), record())).toMatchObject({ siteId, lineId, source: 'api', version: 3, leading: true });
    expect(toLineIndexRow(surface({ runs: true, leads: false }), record()).leading).toBe(false);
  });

  it('serializes an object payload and passes text through', () => {
    expect(wirePayloadOf({ a: 1 })).toBe('{"a":1}');
    expect(wirePayloadOf('raw')).toBe('raw');
    expect(wirePayloadOf(undefined)).toBe('');
  });
});
