/**
 * Learned addresses. On a line that learns them, a station is bound to the
 * address that first claims it. A claim that disagrees with a binding (a
 * station already bound to another address, or an address bound to another
 * station) is a person's decision: one registration row per claim, and the
 * claimant's messages have no effect until it is approved. Lines that declare
 * their addresses pass through unchanged.
 */

import { DECISION, ROW_TYPE } from '../contracts';
import { ADDRESSING, identOf, learnsAddress, operatorRole, type LineDef } from '../../../lib/machines/line';
import { addressOf, isTopicLevel, type Inspection, type MachineIdent } from '../../../lib/machines/protocol';
import type { EscalationEvent } from '../../../lib/machines/transport';
import type { Action, CreateRowInput } from './actions';
import type { GatewayState } from './state';

export const SENDER = { KNOWN: 'known', BOUND: 'bound', CONTESTED: 'contested', UNKNOWN: 'unknown' } as const;
export type SenderStatus = typeof SENDER[keyof typeof SENDER];

export interface Sender {
  status: SenderStatus;
  address: string;
  /** The station the message is from (known, bound) or claims to be (contested). */
  machineId?: string;
  /** The inspection with the station as its machine id; set when the message may be acted on. */
  seen?: Inspection;
}

const onLine = (line: LineDef, machineId: string | undefined): machineId is string =>
  !!machineId && line.machines.some((m) => m.machineId === machineId);

function declaredAt(line: LineDef, machineId: string, address: string): boolean {
  return onLine(line, machineId) && !learnsAddress(line, machineId) && addressOf(identOf(line, machineId)) === address;
}

function asStation(seen: Inspection, machineId: string, address: string): Inspection {
  return { ...seen, parsed: { ...seen.parsed!, ident: { ...seen.parsed!.ident, machineId, address } } };
}

/** Who sent a message: a known station, one bound just now, a contested claim, or no station at all. */
export function resolveSender(state: GatewayState, line: LineDef, seen: Inspection): Sender {
  const ident = seen.parsed!.ident;
  const address = ident.address ?? ident.machineId;
  if (line.addressing !== ADDRESSING.LEARNED) return { status: SENDER.KNOWN, address, machineId: ident.machineId, seen };
  // A station whose address the line declares is known only on that address.
  if (declaredAt(line, ident.machineId, address)) return { status: SENDER.KNOWN, address, machineId: ident.machineId, seen };
  const claim = seen.claim ?? (ident.address ? ident.machineId : undefined);
  const bound = state.stationAt(address);
  if (bound) {
    if (claim && claim !== bound) return { status: SENDER.CONTESTED, address, machineId: claim };
    return { status: SENDER.KNOWN, address, machineId: bound, seen: asStation(seen, bound, address) };
  }
  if (!onLine(line, claim) || !learnsAddress(line, claim)) return { status: SENDER.UNKNOWN, address };
  if (state.learnedAddress(claim)) return { status: SENDER.CONTESTED, address, machineId: claim };
  return { status: SENDER.BOUND, address, machineId: claim, seen: asStation(seen, claim, address) };
}

/** A station's identity on the wire, with the address the line learned for it. */
export function identFor(state: GatewayState, line: LineDef, machineId: string): MachineIdent {
  const learned = learnsAddress(line, machineId) ? state.learnedAddress(machineId) : undefined;
  return { ...identOf(line, machineId), ...(learned ? { address: learned } : {}) };
}

/** Whether the gateway knows where to send to a station: a declared address, or one it learned. */
export function reachable(state: GatewayState, line: LineDef, machineId: string): boolean {
  return !learnsAddress(line, machineId) || !!state.learnedAddress(machineId);
}

/** The row asking a person whether `address` is `machineId`. */
export function registrationRow(state: GatewayState, line: LineDef, address: string, machineId: string): CreateRowInput {
  const boundAddress = state.learnedAddress(machineId) ?? null;
  const boundStation = state.stationAt(address) ?? null;
  const now = [
    boundAddress ? `${machineId} is bound to ${boundAddress}` : null,
    boundStation ? `${address} is bound to ${boundStation}` : null,
  ].filter(Boolean).join('; ');
  return {
    type: ROW_TYPE.MACHINE_REGISTRATION, role: operatorRole(line), priority: 2,
    description: `${address} says it is ${machineId}. ${now}. Approve to bind ${machineId} to ${address}.`,
    metadata: { siteId: line.siteId, lineId: line.lineId, machineId, address, boundAddress, boundStation },
  };
}

/** A row's resolver payload, which Long Tail stores serialized. */
function resolutionOf(raw: unknown): Record<string, any> | null {
  if (raw && typeof raw === 'object') return raw as Record<string, any>;
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Why an approved registration may not bind; null when it may. The row is only a request:
 * the station must learn its address, the address must be one a machine could send from,
 * and a machine at that address must have claimed the station on the wire.
 */
function bindingRefusal(state: GatewayState, line: LineDef, machineId: string, address: string): string | null {
  if (!onLine(line, machineId) || !learnsAddress(line, machineId)) return `${machineId} is not a station on this line that learns its address`;
  if (!isTopicLevel(address)) return `"${address}" is not an address a machine can send from`;
  if (line.machines.some((m) => declaredAt(line, m.machineId, address))) return `${address} is the declared address of another station`;
  if (!state.claimHeard(address, machineId)) return `no machine at ${address} has claimed ${machineId} since this gateway took the line`;
  return null;
}

/** A person decided a registration row: approval binds the station to the claimant; anything else leaves the binding. */
export function planRegistrationRow(state: GatewayState, line: LineDef, event: EscalationEvent): Action[] {
  const md = event.data?.metadata ?? {};
  if (typeof md.machineId !== 'string' || typeof md.address !== 'string') return [];
  if (event.verb === 'created') {
    state.raiseClaim(md.address, md.machineId);
    return [];
  }
  state.settleClaim(md.address, md.machineId);
  const approved = event.verb === 'resolved' && resolutionOf(event.data?.resolver_payload)?.decision === DECISION.APPROVE;
  const by = event.data?.resolved_by ?? event.data?.metadata?.resolved_by ?? undefined;
  if (!approved) return [];
  const reason = bindingRefusal(state, line, md.machineId, md.address);
  return reason
    ? [{ kind: 'refuseBinding', machineId: md.machineId, address: md.address, reason }]
    : [{ kind: 'bindAddress', machineId: md.machineId, address: md.address, by }];
}
