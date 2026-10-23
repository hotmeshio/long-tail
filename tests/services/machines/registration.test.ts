import { describe, it, expect } from 'vitest';

import { DECISION, ROW_TYPE } from '../../../services/machines/contracts';
import { SENDER, identFor, planRegistrationRow, reachable, registrationRow, resolveSender } from '../../../services/machines/gateway/registration';
import { GatewayState } from '../../../services/machines/gateway/state';
import { MESSAGE_KIND, type Inspection } from '../../../lib/machines/protocol';
import type { EscalationEvent } from '../../../lib/machines/transport';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { MemoryAddressBook } from '../../../services/machines/gateway/address-book';
import { planEscalationEvent } from '../../../services/machines/gateway/plan-escalation';
import { planPacing } from '../../../services/machines/gateway/pacing';
import { DISPATCH_STATE } from '../../../services/machines/gateway/state';
import { facetsFor } from '../../helpers/machine-line-gateway-harness';

const LEARNED = { ...DEFAULT_LINE, addressing: 'learned' as const };
const UUID_A = '8f77e321-53de-4a60-988b-27f4b46a922d';
const UUID_B = '1a2b3c4d-0000-4000-8000-000000000001';

/** A message from `address`, claiming `station` when given. */
function from(address: string, station?: string): Inspection {
  return {
    parsed: { ident: { siteId: LEARNED.siteId, lineId: LEARNED.lineId, machineId: address }, kind: MESSAGE_KIND.PRESENCE },
    body: null, violations: [], ...(station ? { claim: station } : {}),
  };
}

function event(verb: string, metadata: Record<string, unknown>, extra: Record<string, unknown> = {}): EscalationEvent {
  return { type: 'escalation', escalationId: 'reg-1', role: 'line-operator', verb, data: { type: ROW_TYPE.MACHINE_REGISTRATION, metadata, ...extra } } as EscalationEvent;
}

describe('resolveSender', () => {
  it('passes every message through on a line that declares its addresses', () => {
    expect(resolveSender(new GatewayState(), DEFAULT_LINE, from('press-01'))).toMatchObject({ status: SENDER.KNOWN, machineId: 'press-01' });
  });

  it('binds an unbound station to the first address that claims it, then knows that address by its station', () => {
    const state = new GatewayState();
    const first = resolveSender(state, LEARNED, from(UUID_A, 'press-01'));
    expect(first).toMatchObject({ status: SENDER.BOUND, address: UUID_A, machineId: 'press-01' });
    expect(first.seen!.parsed!.ident).toMatchObject({ machineId: 'press-01', address: UUID_A });
    state.bindAddress('press-01', UUID_A);
    expect(resolveSender(state, LEARNED, from(UUID_A))).toMatchObject({ status: SENDER.KNOWN, machineId: 'press-01' });
    expect(resolveSender(state, LEARNED, from(UUID_A, 'press-01')).status).toBe(SENDER.KNOWN);
  });

  it('is contested when another address claims a bound station, or a bound address claims another station', () => {
    const state = new GatewayState();
    state.bindAddress('press-01', UUID_A);
    expect(resolveSender(state, LEARNED, from(UUID_B, 'press-01'))).toEqual({ status: SENDER.CONTESTED, address: UUID_B, machineId: 'press-01' });
    expect(resolveSender(state, LEARNED, from(UUID_A, 'cut-01'))).toEqual({ status: SENDER.CONTESTED, address: UUID_A, machineId: 'cut-01' });
  });

  it('is unknown with no claim, a claim of no station, or a claim of a station whose address is declared', () => {
    const state = new GatewayState();
    const mixed = { ...LEARNED, machines: LEARNED.machines.map((m) => (m.machineId === 'cut-01' ? { ...m, address: UUID_B } : m)) };
    expect(resolveSender(state, LEARNED, from(UUID_A)).status).toBe(SENDER.UNKNOWN);
    expect(resolveSender(state, LEARNED, from(UUID_A, 'mill-99')).status).toBe(SENDER.UNKNOWN);
    expect(resolveSender(state, mixed, from(UUID_A, 'cut-01')).status).toBe(SENDER.UNKNOWN);
  });
});

describe('identFor and reachable', () => {
  it('a learned station is reachable once bound, at the address it learned; a declared one always is', () => {
    const state = new GatewayState();
    expect(reachable(state, LEARNED, 'press-01')).toBe(false);
    expect(reachable(state, DEFAULT_LINE, 'press-01')).toBe(true);
    state.bindAddress('press-01', UUID_A);
    expect(reachable(state, LEARNED, 'press-01')).toBe(true);
    expect(identFor(state, LEARNED, 'press-01')).toMatchObject({ machineId: 'press-01', address: UUID_A });
    expect(identFor(state, DEFAULT_LINE, 'press-01')).not.toHaveProperty('address');
  });

  it('binding an address to a new station frees the station it held', () => {
    const state = new GatewayState();
    state.bindAddress('press-01', UUID_A);
    state.bindAddress('cut-01', UUID_A);
    expect(state.learnedAddress('press-01')).toBeUndefined();
    expect(state.stationAt(UUID_A)).toBe('cut-01');
  });
});

describe('registration rows', () => {
  it('asks the operator whether the address is the station, naming what each is bound to now', () => {
    const state = new GatewayState();
    state.bindAddress('press-01', UUID_A);
    const row = registrationRow(state, LEARNED, UUID_B, 'press-01');
    expect(row).toMatchObject({ type: ROW_TYPE.MACHINE_REGISTRATION, role: 'line-operator' });
    expect(row.metadata).toEqual({ siteId: 'site-1', lineId: 'line-1', machineId: 'press-01', address: UUID_B, boundAddress: UUID_A, boundStation: null });
    expect(row.description).toContain(`press-01 is bound to ${UUID_A}`);
  });

  it('approval binds the station to the claimant, naming who approved; rejection changes nothing', () => {
    const state = new GatewayState();
    const md = { machineId: 'press-01', address: UUID_B };
    expect(planRegistrationRow(state, event('created', md))).toEqual([]);
    expect(state.claimRaised(UUID_B, 'press-01')).toBe(true);
    expect(planRegistrationRow(state, event('resolved', md, { resolver_payload: { decision: DECISION.APPROVE }, resolved_by: 'person-1' })))
      .toEqual([{ kind: 'bindAddress', machineId: 'press-01', address: UUID_B, by: 'person-1' }]);
    expect(state.claimRaised(UUID_B, 'press-01')).toBe(false);
    expect(planRegistrationRow(state, event('resolved', md, { resolver_payload: { decision: DECISION.REJECT } }))).toEqual([]);
  });

  it('reads the decision from the row as Long Tail stores it, serialized', () => {
    const md = { machineId: 'press-01', address: UUID_B };
    expect(planRegistrationRow(new GatewayState(), event('resolved', md, { resolver_payload: JSON.stringify({ decision: DECISION.APPROVE }) })))
      .toEqual([{ kind: 'bindAddress', machineId: 'press-01', address: UUID_B, by: undefined }]);
  });
});

describe('a station that has not registered', () => {
  it('keeps its handoffs waiting, then pacing sends them once it has an address', () => {
    const state = new GatewayState();
    const created = { type: 'escalation', escalationId: 'h1', role: 'line-bond', verb: 'created', data: { type: ROW_TYPE.HANDOFF, metadata: facetsFor('U1', null, 'press-01') } } as EscalationEvent;
    expect(planEscalationEvent(state, LEARNED, created, 60_000)).toEqual([]);
    expect(state.get('h1')!.dispatch).toBe(DISPATCH_STATE.WAITING);
    expect(planPacing(state, LEARNED, 60_000)).toEqual([]);
    state.bindAddress('press-01', UUID_A);
    expect(planPacing(state, LEARNED, 60_000)).toEqual([expect.objectContaining({ kind: 'dispatch', rowId: 'h1', machineId: 'press-01' })]);
  });
});

describe('MemoryAddressBook', () => {
  it('keeps one address per station and one station per address', async () => {
    const book = new MemoryAddressBook();
    await book.bind('press-01', UUID_A);
    await book.bind('cut-01', UUID_A);
    expect([...(await book.load())]).toEqual([['cut-01', UUID_A]]);
  });
});
