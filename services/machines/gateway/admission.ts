/**
 * What happens to a decoded machine message before the planner sees it: the
 * sender is checked against the line's learned addresses (registration.ts),
 * and under a strict codec a message that breaks the contract is held for a
 * person instead of acted on.
 */

import { ROW_TYPE } from '../contracts';
import { operatorRole, type LineDef } from '../../../lib/machines/line';
import type { Inspection } from '../../../lib/machines/protocol';
import { DISPOSITION, type Disposition, type InboundMessage } from '../../../lib/machines/transport';
import type { Action } from './actions';
import { GATEWAY_LOG, type GatewayLog } from './log';
import { SENDER, registrationRow, resolveSender } from './registration';
import type { GatewayState } from './state';

/** What handling one decoded message came to. */
export interface Applied {
  disposition: Disposition;
  failed: boolean;
}

export interface AdmissionContext {
  state: GatewayState;
  line: LineDef;
  executor: { apply(actions: Action[]): Promise<void> };
  log: GatewayLog;
  /** Send waiting handoffs that may now go out. */
  pace(): Promise<void>;
}

/**
 * The station a message is from (registration.ts). A newly claimed station is
 * bound and its waiting work goes out; a contested claim raises one row for a
 * person; either of those, and an address no station claims, is not acted on.
 */
export async function admitSender(ctx: AdmissionContext, topic: string, raw: Inspection): Promise<Inspection | Applied> {
  const sender = resolveSender(ctx.state, ctx.line, raw);
  try {
    if (sender.status === SENDER.BOUND) {
      await ctx.executor.apply([{ kind: 'bindAddress', machineId: sender.machineId!, address: sender.address }]);
      await ctx.pace();
    }
    if (sender.seen) return sender.seen;
    if (sender.status === SENDER.CONTESTED && !ctx.state.claimRaised(sender.address, sender.machineId!)) {
      await ctx.executor.apply([{ kind: 'createRow', row: registrationRow(ctx.state, ctx.line, sender.address, sender.machineId!) }]);
      ctx.state.raiseClaim(sender.address, sender.machineId!);
      ctx.log.warn(GATEWAY_LOG.ADDRESS_CONTESTED, { topic, address: sender.address, machine: sender.machineId });
    }
    if (sender.status === SENDER.UNKNOWN && ctx.state.firstHeardStranger(sender.address)) ctx.log.warn(GATEWAY_LOG.ADDRESS_UNKNOWN, { topic, address: sender.address });
    return { disposition: DISPOSITION.ACK, failed: false };
  } catch (err: any) {
    ctx.log.error(GATEWAY_LOG.VERB_FAILED, { topic, error: err.message });
    return { disposition: DISPOSITION.NAK, failed: true };
  }
}

/** Under a strict codec a broken message is not acted on: a person sees it on a row, once. */
export async function holdViolation(ctx: AdmissionContext, msg: InboundMessage, seen: Inspection): Promise<Applied> {
  const { ident, kind } = seen.parsed!;
  const key = seen.receiptId ?? seen.body?.id ?? `${msg.topic}:${msg.payload}`;
  if (ctx.state.violationRaised(key)) return { disposition: DISPOSITION.ACK, failed: false };
  try {
    await ctx.executor.apply([{ kind: 'createRow', row: {
      type: ROW_TYPE.CONTRACT_VIOLATION, role: operatorRole(ctx.line), priority: 2,
      description: `${ident.machineId} sent a ${kind} message that breaks the contract: ${seen.violations.join('; ')}`,
      metadata: { siteId: ident.siteId, lineId: ident.lineId, machineId: ident.machineId, kind, topic: msg.topic, messageId: seen.body?.id ?? null, violations: seen.violations },
      escalation_payload: msg.payload,
    } }]);
    ctx.state.raiseViolation(key);
    return { disposition: DISPOSITION.ACK, failed: false };
  } catch (err: any) {
    ctx.log.error(GATEWAY_LOG.VERB_FAILED, { topic: msg.topic, error: err.message });
    return { disposition: DISPOSITION.NAK, failed: true };
  }
}
