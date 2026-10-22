import { describe, it, expect } from 'vitest';

import {
  computeRoster,
  rosterHeadline,
  type RosterDef,
} from '../../../shared/form-validation/x-lt-roster';

const BATCH: RosterDef = { expected: { batch: true } };
const keys = ['00812999000011#1', '00812999000011#2', '00812999000028'];

const host = (extra: { pending?: string[]; flags?: Record<string, unknown>; resolver?: Record<string, unknown> } = {}) => ({
  metadata: { batch_keys: keys, batch_pending: extra.pending ?? keys },
  envelope: extra.flags ? { batch_flags: extra.flags } : {},
  resolver: extra.resolver ?? {},
});

describe('computeRoster on a batch with flags', () => {
  it('reads a flagged pending key as flagged under its label', () => {
    const result = computeRoster(BATCH, host({ flags: { '00812999000028': { label: 'Missing', at: '2026-10-21T10:00:00Z' } } }));
    expect(result.entries.map((e) => [e.key, e.state, e.flag])).toEqual([
      ['00812999000011#1', 'waiting', undefined],
      ['00812999000011#2', 'waiting', undefined],
      ['00812999000028', 'flagged', 'Missing'],
    ]);
    expect(result.counts).toMatchObject({ expected: 3, in: 0, flagged: 1, waiting: 2, outstanding: 2 });
    expect(rosterHeadline(result)).toBe('0 of 3 in · 1 Missing');
  });

  it('reads a flagged key that has since filled as in', () => {
    const result = computeRoster(BATCH, host({
      pending: ['00812999000011#1', '00812999000011#2'],
      flags: { '00812999000028': { label: 'Missing' } },
    }));
    expect(result.entries[2]).toMatchObject({ state: 'in' });
    expect(result.counts.flagged).toBe(0);
  });

  it('ignores a flag without a label', () => {
    const result = computeRoster(BATCH, host({ flags: { '00812999000028': { payload: {} } } }));
    expect(result.counts.flagged).toBe(0);
  });
});

describe('computeRoster countedBy', () => {
  const COUNTED: RosterDef = { expected: { batch: true }, in: ['items', 'resolver.shoes'], countedBy: '#' };

  it('ticks the nth key for the nth scan of a code', () => {
    const one = computeRoster(COUNTED, host({ resolver: { shoes: ['00812999000011'] } }));
    expect(one.entries.filter((e) => e.state === 'in').map((e) => e.key)).toEqual(['00812999000011#1']);
    const two = computeRoster(COUNTED, host({ resolver: { shoes: ['00812999000011', '00812999000011'] } }));
    expect(two.entries.filter((e) => e.state === 'in').map((e) => e.key))
      .toEqual(['00812999000011#1', '00812999000011#2']);
  });

  it('still ticks a key declared without an ordinal', () => {
    const result = computeRoster(COUNTED, host({ resolver: { shoes: ['00812999000028'] } }));
    expect(result.entries.find((e) => e.key === '00812999000028')!.state).toBe('in');
  });

  it('compares exactly without countedBy', () => {
    const exact: RosterDef = { expected: { batch: true }, in: ['resolver.shoes'] };
    const result = computeRoster(exact, host({ resolver: { shoes: ['00812999000011'] } }));
    expect(result.counts.in).toBe(0);
  });

  it('leaves held keys exact', () => {
    const result = computeRoster(COUNTED, host({ pending: ['00812999000011#2', '00812999000028'] }));
    expect(result.entries.filter((e) => e.state === 'in').map((e) => e.key)).toEqual(['00812999000011#1']);
  });
});
