import { describe, it, expect } from 'vitest';

import { hopFacets, hopRow, planHops, readHopOutcome, type RouteStep, type UnitRouteInput } from '../../../examples/workflows/machine-line/workflows/route';

const INPUT: UnitRouteInput = {
  siteId: 'site-1',
  lineId: 'line-1',
  routeKey: 'R1',
  orderRef: 'ORD-1',
  units: [{ unitId: 'U1', carrierId: 'CR-U1' }, { unitId: 'U2', carrierId: 'CR-U2' }],
  steps: [
    { machineId: 'press-01', process: 'bond', recipe: { id: 'RCP-BOND-A', version: '2' } },
    { machineId: 'cut-01', process: 'trim', recipe: { id: 'RCP-TRIM-A', version: '1' } },
  ],
  artifact: { url: 'http://site/payloads/a', sha256: 'abc' },
};

describe('unit route: hops', () => {
  it('runs entry → each machine → exit', () => {
    const hops = planHops(INPUT.steps);
    const name = (s: RouteStep | null) => (s && 'machineId' in s ? s.machineId : null);
    expect(hops.map((h) => [name(h.from), name(h.to)])).toEqual([
      [null, 'press-01'], ['press-01', 'cut-01'], ['cut-01', null],
    ]);
    expect(hops.map((h) => h.index)).toEqual([0, 1, 2]);
  });

  it('names the receiver job, the sender job and the attempt on each hop', () => {
    const [entry, middle, exit] = planHops(INPUT.steps);
    expect(hopFacets(INPUT, entry, 1)).toMatchObject({ jobId: 'R1-press-01', senderJobId: null, fromMachine: null, toMachine: 'press-01', recipeId: 'RCP-BOND-A', artifactUrl: 'http://site/payloads/a' });
    expect(hopFacets(INPUT, middle, 2)).toMatchObject({ jobId: 'R1-cut-01', senderJobId: 'R1-press-01', attempt: 2, units: INPUT.units });
    expect(hopFacets(INPUT, exit, 1)).toMatchObject({ jobId: 'R1-exit', toMachine: null, recipeId: null, artifactUrl: null });
  });

  it('parks each hop for the receiver role, and the last one for a person at line exit', () => {
    const [entry, , exit] = planHops(INPUT.steps);
    expect(hopRow(INPUT, entry, 1)).toMatchObject({ role: 'line-bond', type: 'handoff', subtype: 'bond' });
    expect(hopRow(INPUT, exit, 1)).toMatchObject({ role: 'line-exit', subtype: 'exit' });
    expect(hopRow(INPUT, exit, 1).description).toMatch(/U1, U2 from cut-01/);
  });
});

describe('unit route: stations people work', () => {
  const MIXED: UnitRouteInput = {
    ...INPUT, exitRole: 'inspector',
    steps: [INPUT.steps[0], { role: 'finisher' }],
  };

  it('parks a person\'s handoff on that person\'s role, with no machine to dispatch', () => {
    const [, intoFinisher, exit] = planHops(MIXED.steps);
    expect(hopRow(MIXED, intoFinisher, 1)).toMatchObject({ role: 'finisher', subtype: 'finisher' });
    expect(hopFacets(MIXED, intoFinisher, 1)).toMatchObject({ fromMachine: 'press-01', toMachine: null, recipeId: null, jobId: 'R1-finisher' });
  });

  it('hands from a person to the exit role the route names', () => {
    const [, , exit] = planHops(MIXED.steps);
    expect(hopRow(MIXED, exit, 1)).toMatchObject({ role: 'inspector', subtype: 'exit' });
    expect(hopFacets(MIXED, exit, 1)).toMatchObject({ fromMachine: null, toMachine: null, senderJobId: 'R1-finisher' });
  });
});

describe('unit route: reading a finished handoff', () => {
  it('reads a receipt, an error, a timeout and a cancel', () => {
    expect(readHopOutcome({ $trigger: 'resolve', received: true, units: ['U1'] })).toEqual({ received: true });
    expect(readHopOutcome({ $trigger: 'resolve', received: false, errorCode: 'jam', detail: 'cut-01 reported jam' }))
      .toEqual({ received: false, errorCode: 'jam', detail: 'cut-01 reported jam' });
    expect(readHopOutcome({ $trigger: 'timeout', $accumulated: [] })).toMatchObject({ received: false, errorCode: 'handoff-timeout' });
    expect(readHopOutcome(null)).toMatchObject({ received: false, errorCode: 'cancelled' });
  });
});
