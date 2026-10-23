import { describe, it, expect } from 'vitest';

import { hopFacets, hopRow, pickupRow, planHops, readHopOutcome, type RouteStep, type UnitRouteInput } from '../../../examples/workflows/machine-line/workflows/route';

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
    expect(hopFacets(INPUT, middle, 2)).toMatchObject({ jobId: 'R1-cut-01-a2', senderJobId: 'R1-press-01', attempt: 2, units: INPUT.units });
    expect(hopFacets(INPUT, exit, 1)).toMatchObject({ jobId: 'R1-exit', toMachine: null, recipeId: null, artifactUrl: null });
  });

  it('parks each hop for the receiver role, and the last one for a person at line exit', () => {
    const [entry, , exit] = planHops(INPUT.steps);
    expect(hopRow(INPUT, entry, 1)).toMatchObject({ role: 'line-bond', type: 'handoff', subtype: 'bond' });
    expect(hopRow(INPUT, exit, 1)).toMatchObject({ role: 'line-exit', subtype: 'exit' });
    expect(hopRow(INPUT, exit, 1).description).toMatch(/U1, U2 from cut-01/);
  });
});

describe('unit route: retries', () => {
  it('gives a retry its own receiver job, and the next hop the sender job that succeeded', () => {
    const [, middle, exit] = planHops(INPUT.steps);
    expect(hopFacets(INPUT, middle, 2)).toMatchObject({ jobId: 'R1-cut-01-a2', senderJobId: 'R1-press-01' });
    expect(hopFacets(INPUT, exit, 1, 2)).toMatchObject({ jobId: 'R1-exit', senderJobId: 'R1-cut-01-a2' });
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

describe('unit route: a pickup row', () => {
  it('asks a person to collect some units at a station, naming no sender so no machine event touches it', () => {
    const cut = INPUT.steps[1];
    const row = pickupRow(INPUT, 4, cut, [INPUT.units[1]]);
    expect(row).toMatchObject({ role: 'line-exit', subtype: 'pickup', description: `Collect ${INPUT.units[1].unitId} at cut-01 and take them off the line` });
    expect(row.metadata).toMatchObject({ units: [INPUT.units[1]], fromMachine: null, senderJobId: null, toMachine: null, jobId: 'R1-pickup-cut-01', pickupAt: 'cut-01' });
  });
});

describe('unit route: reading a finished handoff', () => {
  const units = ['U1', 'U2'];
  const items = (...keys: string[]) => keys.map((itemKey) => ({ itemKey }));

  it('reads a receipt, an error, a timeout and a cancel', () => {
    expect(readHopOutcome({ $trigger: 'resolve', received: true, units }, units)).toEqual({ received: true });
    expect(readHopOutcome({ $trigger: 'resolve', received: false, errorCode: 'jam', detail: 'cut-01 reported jam', $accumulated: [] }, units))
      .toEqual({ received: false, errorCode: 'jam', detail: 'cut-01 reported jam', arrived: [], missing: units });
    expect(readHopOutcome({ $trigger: 'timeout', $accumulated: [] }, units)).toMatchObject({ received: false, errorCode: 'handoff-timeout' });
    expect(readHopOutcome(null, units)).toMatchObject({ received: false, errorCode: 'cancelled' });
  });

  it('reads a timeout after some units arrived as a partial arrival, with the units as data', () => {
    const $accumulated = items('released:U1', 'released:U2', 'arrived:U2');
    expect(readHopOutcome({ $trigger: 'timeout', $accumulated }, units)).toEqual({
      received: false, errorCode: 'partial-arrival', detail: 'U2 arrived; the rest did not before the timeout', arrived: ['U2'], missing: ['U1'],
    });
    expect(readHopOutcome({ $trigger: 'timeout', $accumulated: $accumulated.slice(0, 2) }, units)).toMatchObject({ errorCode: 'handoff-timeout', missing: units });
  });

  it('a failure the gateway reports still says which units arrived', () => {
    const outcome = readHopOutcome({ $trigger: 'resolve', received: false, errorCode: 'jam', $accumulated: items('arrived:U1') }, units);
    expect(outcome).toMatchObject({ errorCode: 'jam', arrived: ['U1'], missing: ['U2'] });
  });
});
