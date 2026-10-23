import { describe, it, expect } from 'vitest';

import { mergeTrace, readTrace, traceEntry, traceFacets } from '../../../services/machines/gateway/trace';

const finished = { event: 'finished', unitId: 'U1', jobId: 'J1', result: 'ok', materials: [{ material: 'FILM', lot: 'L-1' }, { material: 'TOP', lot: 'L-2' }] };

describe('traceEntry', () => {
  it('keeps the unit, machine, job, result and lots of a finished record', () => {
    expect(traceEntry('press-01', finished)).toEqual({ unitId: 'U1', machineId: 'press-01', jobId: 'J1', result: 'ok', materials: finished.materials });
  });

  it('drops materials without a material or a lot, and tolerates a record without any', () => {
    expect(traceEntry('press-01', { unitId: 'U1', materials: [{ material: 'FILM' }, { lot: 'L-9' }, 'x'] }).materials).toEqual([]);
    expect(traceEntry('press-01', { unitId: 'U1' })).toMatchObject({ jobId: null, result: null, materials: [] });
  });
});

describe('mergeTrace', () => {
  it('keeps one entry per unit and machine, the later one winning', () => {
    const a = traceEntry('press-01', finished);
    const b = traceEntry('press-01', { ...finished, result: 'reject' });
    const c = traceEntry('cut-01', finished);
    expect(mergeTrace([a], [b, c])).toEqual([b, c]);
    expect(mergeTrace(undefined, undefined)).toEqual([]);
  });
});

describe('traceFacets', () => {
  it('lists every lot once', () => {
    const trace = [traceEntry('press-01', finished), traceEntry('press-01', { ...finished, unitId: 'U2' })];
    expect(traceFacets(trace)).toEqual({ trace, lots: ['L-1', 'L-2'] });
  });
});

describe('readTrace', () => {
  it('reads a row trace back and drops malformed entries', () => {
    const entry = traceEntry('press-01', finished);
    expect(readTrace({ trace: [entry, { unitId: 'U9' }, null] })).toEqual([entry]);
    expect(readTrace({})).toEqual([]);
    expect(readTrace({ trace: 'nope' })).toEqual([]);
  });
});
