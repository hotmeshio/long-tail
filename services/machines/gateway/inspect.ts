/**
 * A dry run of one wire message: what the codec reads and what the gateway
 * would do, planned on a copy of the state so the line is untouched and no
 * row is created or changed.
 */

import type { LineDef } from '../../../lib/machines/line';
import type { Inspection, LineCodec } from '../../../lib/machines/protocol';
import type { InboundMessage } from '../../../lib/machines/transport';
import type { InspectResult, WireAction } from '../../../types/machines-view';
import { planMachineMessage } from './plan-machine';
import { SENDER, resolveSender } from './registration';
import type { GatewayState } from './state';
import { appliedActions, eventOf, plannedAction, summarize } from './wire';

export interface DryRunContext {
  state: GatewayState;
  line: LineDef;
  codec: LineCodec;
  dispatchTtlMs: number;
}

/** What admitting the sender would do, or null when the message would be acted on. */
function admission(state: GatewayState, line: LineDef, raw: Inspection): { actions: WireAction[]; seen: Inspection | null } {
  const sender = resolveSender(state, line, raw);
  if (sender.status === SENDER.BOUND) return { seen: sender.seen!, actions: [{ verb: 'ack', detail: `bind ${sender.machineId} to ${sender.address}` }] };
  if (sender.seen) return { seen: sender.seen, actions: [] };
  if (sender.status === SENDER.UNKNOWN) return { seen: null, actions: [{ verb: 'none', detail: `${sender.address} claims no station on this line` }] };
  const raised = state.claimRaised(sender.address, sender.machineId!);
  return {
    seen: null,
    actions: [raised
      ? { verb: 'none', detail: `${sender.address} says it is ${sender.machineId}; waiting for a person` }
      : { verb: 'create-row', detail: `${sender.address} says it is ${sender.machineId}; a person decides` }],
  };
}

function planOne(ctx: DryRunContext, state: GatewayState, raw: Inspection): WireAction[] {
  const admitted = admission(state, ctx.line, raw);
  if (!admitted.seen) return admitted.actions;
  if (raw.violations.length && ctx.codec.strict) return [...admitted.actions, { verb: 'hold', detail: raw.violations.join('; ') }];
  try {
    const plan = planMachineMessage(state, admitted.seen.parsed!, admitted.seen.body, ctx.dispatchTtlMs);
    const actions = [...admitted.actions, ...plan.actions.map(plannedAction)];
    return appliedActions({ disposition: plan.disposition, failed: false, actions }, 1);
  } catch (err: any) {
    return [...admitted.actions, { verb: 'unreadable', detail: err.message }];
  }
}

export function dryRun(ctx: DryRunContext, msg: InboundMessage): InspectResult {
  let decoded: Inspection[];
  try {
    decoded = ctx.codec.decode(msg.topic, msg.payload, msg.retained);
  } catch (err: any) {
    return { kind: null, event: null, summary: err.message, inspections: [], violations: [], actions: [{ verb: 'unreadable', detail: err.message }] };
  }
  if (!decoded.length) {
    return { kind: null, event: null, summary: 'not a machine message', inspections: [], violations: [], actions: [{ verb: 'none', detail: 'not a machine message' }] };
  }
  const state = ctx.state.clone();
  const actions: WireAction[] = [];
  const violations: string[] = [];
  for (const raw of decoded) {
    violations.push(...raw.violations);
    if (raw.parsed) actions.push(...planOne(ctx, state, raw));
  }
  const [first] = decoded;
  return {
    kind: first.parsed?.kind ?? null, event: eventOf(first), summary: summarize(first),
    inspections: decoded, violations, actions: actions.length ? actions : [{ verb: 'unreadable', detail: 'unknown topic' }],
  };
}
