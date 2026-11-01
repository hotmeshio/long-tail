/**
 * What happens to a decoded machine message before the planner sees it: the
 * sender is checked against the line's learned addresses (registration.ts),
 * and under a strict codec a message that breaks the contract is held for a
 * person instead of acted on.
 */

import { HANDOFF_ERROR, ROW_TYPE } from '../contracts';
import type { OpenRowQuery } from '../rows';
import { operatorRole, type LineDef } from '../../../lib/machines/line';
import { JOB_EVENT, MESSAGE_KIND, type Inspection } from '../../../lib/machines/protocol';
import { DISPOSITION, type Disposition, type InboundMessage } from '../../../lib/machines/transport';
import type { WireAction } from '../../../types/machines-view';
import type { Action } from './actions';
import { GatewayStopped } from './dispatcher';
import { GATEWAY_LOG, type GatewayLog } from './log';
import { SENDER, registrationRow, resolveSender, type Sender } from './registration';
import type { GatewayState } from './state';

/** What handling one decoded message came to, with what the gateway did for the wire record. */
export interface Applied {
  disposition: Disposition;
  failed: boolean;
  actions: WireAction[];
  /** The address the message came from, when it was not admitted as a station's. */
  sender?: { machineId: string | null; address: string | null };
}

/** A message admitted as a station's, with what admitting it did (a binding, say). */
export interface Admitted {
  seen: Inspection;
  actions: WireAction[];
}

export interface AdmissionContext {
  state: GatewayState;
  line: LineDef;
  executor: { apply(actions: Action[]): Promise<WireAction[]> };
  log: GatewayLog;
  /** Send waiting handoffs that may now go out. */
  pace(): Promise<void>;
  /** The controller's pending rows of a type, for the rows shown to people once. */
  openRows(query: OpenRowQuery): Promise<Record<string, any>[]>;
}

function from(sender: Sender): Applied['sender'] {
  return { machineId: sender.machineId ?? null, address: sender.address };
}

/**
 * The station a message is from (registration.ts). A newly claimed station is
 * bound and its waiting work goes out; a contested claim raises one row for a
 * person; either of those, and an address no station claims, is not acted on.
 */
export async function admitSender(ctx: AdmissionContext, topic: string, raw: Inspection): Promise<Admitted | Applied> {
  const sender = resolveSender(ctx.state, ctx.line, raw);
  const actions: WireAction[] = [];
  try {
    if (sender.status === SENDER.BOUND) {
      actions.push(...await ctx.executor.apply([{ kind: 'bindAddress', machineId: sender.machineId!, address: sender.address }]));
      await ctx.pace();
    }
    if (sender.seen) return { seen: sender.seen, actions };
    if (sender.status === SENDER.CONTESTED) ctx.state.hearClaim(sender.address, sender.machineId!);
    if (sender.status === SENDER.CONTESTED && !ctx.state.claimRaised(sender.address, sender.machineId!)) {
      const [made] = await ctx.executor.apply([{ kind: 'createRow', row: registrationRow(ctx.state, ctx.line, sender.address, sender.machineId!) }]);
      ctx.state.raiseClaim(sender.address, sender.machineId!, made?.rowId);
      ctx.log.warn(GATEWAY_LOG.ADDRESS_CONTESTED, { topic, address: sender.address, machine: sender.machineId });
      actions.push({ ...made, detail: `${sender.address} says it is ${sender.machineId}; a person decides` });
    } else if (sender.status === SENDER.CONTESTED) {
      actions.push({ verb: 'none', detail: `${sender.address} says it is ${sender.machineId}; waiting for a person` });
    }
    if (sender.status === SENDER.UNKNOWN) {
      if (ctx.state.firstHeardStranger(sender.address)) ctx.log.warn(GATEWAY_LOG.ADDRESS_UNKNOWN, { topic, address: sender.address });
      actions.push({ verb: 'none', detail: `${sender.address} claims no station on this line` });
    }
    return { disposition: DISPOSITION.ACK, failed: false, actions, sender: from(sender) };
  } catch (err: any) {
    if (!(err instanceof GatewayStopped)) ctx.log.error(GATEWAY_LOG.VERB_FAILED, { topic, error: err.message });
    return { disposition: DISPOSITION.NAK, failed: true, actions, sender: from(sender) };
  }
}

/** Under a strict codec a broken message is not acted on: a person sees it on a row, once. */
export async function holdViolation(ctx: AdmissionContext, msg: InboundMessage, seen: Inspection): Promise<Applied> {
  const { ident, kind } = seen.parsed!;
  const key = seen.receiptId ?? seen.body?.id ?? `${msg.topic}:${msg.payload}`;
  const detail = seen.violations.join('; ');
  if (ctx.state.violationRaised(key)) return { disposition: DISPOSITION.ACK, failed: false, actions: [{ verb: 'hold', detail: `${detail} (already shown to a person)` }] };
  try {
    const [made] = await ctx.executor.apply([{ kind: 'createRow', row: {
      type: ROW_TYPE.CONTRACT_VIOLATION, role: operatorRole(ctx.line), priority: 2,
      description: `${ident.machineId} sent a ${kind} message that breaks the contract: ${seen.violations.join('; ')}`,
      metadata: { siteId: ident.siteId, lineId: ident.lineId, machineId: ident.machineId, kind, topic: msg.topic, messageId: seen.body?.id ?? null, violations: seen.violations },
      escalation_payload: msg.payload,
    } }]);
    ctx.state.raiseViolation(key);
    return { disposition: DISPOSITION.ACK, failed: false, actions: [{ verb: 'hold', rowId: made?.rowId, detail }] };
  } catch (err: any) {
    if (!(err instanceof GatewayStopped)) ctx.log.error(GATEWAY_LOG.VERB_FAILED, { topic: msg.topic, error: err.message });
    return { disposition: DISPOSITION.NAK, failed: true, actions: [] };
  }
}

/** A job arrival: a scan, or a transfer that failed on the carrier read. */
export function isArrival(seen: Inspection): boolean {
  const event = seen.body?.body?.event;
  return seen.parsed?.kind === MESSAGE_KIND.JOB && (event === JOB_EVENT.ARRIVED || event === JOB_EVENT.TRANSFER_FAILED);
}

/**
 * An arrival no open handoff into the machine expects, after every delivery:
 * a person sees it on one handoff-error row per machine and carrier, with the
 * raw arrival, so the unit can be re-scanned or routed. Resolving the row lets
 * the next such arrival raise one again.
 */
export async function holdArrival(ctx: AdmissionContext, msg: InboundMessage, seen: Inspection): Promise<Applied> {
  const { ident } = seen.parsed!;
  const body = seen.body?.body ?? {};
  const carrierId = typeof body.carrierId === 'string' ? body.carrierId : null;
  const unitId = typeof body.unitId === 'string' ? body.unitId : null;
  const detail = `no handoff into ${ident.machineId} expects ${carrierId ? `carrier ${carrierId}` : 'an unreadable carrier'}`;
  try {
    const open = await ctx.openRows({ type: ROW_TYPE.HANDOFF_ERROR, role: operatorRole(ctx.line) });
    const shown = open.find((r) => r.metadata?.errorCode === HANDOFF_ERROR.UNMATCHED_ARRIVAL && r.metadata?.machineId === ident.machineId && (r.metadata?.carrierId ?? null) === carrierId);
    if (shown) return { disposition: DISPOSITION.ACK, failed: false, actions: [{ verb: 'unmatched', rowId: shown.id, detail: `${detail} (already shown to a person)` }] };
    const [made] = await ctx.executor.apply([{ kind: 'createRow', row: {
      type: ROW_TYPE.HANDOFF_ERROR, role: operatorRole(ctx.line), priority: 2,
      description: `${ident.machineId} reports an arrival no handoff expects: ${carrierId ? `carrier ${carrierId}` : 'the carrier could not be read'}`,
      metadata: {
        siteId: ident.siteId, lineId: ident.lineId, machineId: ident.machineId, errorCode: HANDOFF_ERROR.UNMATCHED_ARRIVAL,
        carrierId, unitId, event: body.event, topic: msg.topic, messageId: seen.body?.id ?? null, arrival: body,
      },
      escalation_payload: msg.payload,
    } }]);
    return { disposition: DISPOSITION.ACK, failed: false, actions: [{ verb: 'create-row', rowId: made?.rowId, detail }] };
  } catch (err: any) {
    if (!(err instanceof GatewayStopped)) ctx.log.error(GATEWAY_LOG.VERB_FAILED, { topic: msg.topic, error: err.message });
    return { disposition: DISPOSITION.NAK, failed: true, actions: [] };
  }
}

