/**
 * The wire record. Every message a gateway reads, and every command,
 * snapshot request and receipt it sends, becomes one WireEvent for the
 * line's view: what was on the wire, how the codec read it, and what the
 * gateway did about it. Telemetry is left out unless the line asks for it.
 */

import { CHANNEL, MESSAGE_KIND, addressOf, isoTs, type Inspection, type MachineCommand, type MachineIdent, type WireMessage } from '../../../lib/machines/protocol';
import { DISPOSITION, type InboundMessage } from '../../../lib/machines/transport';
import type { WireAction, WireEvent, WireKind } from '../../../types/machines-view';
import type { Action } from './actions';
import type { Applied } from './admission';

export type WireSink = (event: WireEvent) => void;

export const WIRE_EVENT_TYPE = 'machine.wire';
export const WIRE_DIRECTION = { IN: 'in', OUT: 'out' } as const;
const RECEIPT_CHANNEL = 'receipt';
const ALARM_EVENT = { RAISED: 'raised', ACKED: 'acked', CLEARED: 'cleared' } as const;
const PRESENCE_EVENT = { ONLINE: 'online', OFFLINE: 'offline' } as const;

export interface WireOptions {
  /** Publish telemetry messages too. */
  telemetry?: boolean;
}

interface WireLine {
  siteId: string;
  lineId: string;
}

/** The sender a message was read as, when it differs from the topic's. */
export interface WireSender {
  machineId: string | null;
  address: string | null;
}

export class WireRecorder {
  constructor(private readonly line: WireLine, private readonly sink: WireSink, private readonly opts: WireOptions = {}) {}

  /** A decoded inbound message and what the gateway did with it. */
  inbound(msg: InboundMessage, seen: Inspection, applied: Applied, deliveries: number, sender?: WireSender): void {
    if (seen.parsed?.kind === MESSAGE_KIND.TELEMETRY && !this.opts.telemetry) return;
    this.sink({ ...describeInbound(this.line, msg, seen, sender), actions: appliedActions(applied, deliveries) });
  }

  /** A message the codec could not read, or one that is not a machine's. */
  unreadable(msg: InboundMessage, detail: string, verb: WireAction['verb'] = 'unreadable'): void {
    this.sink({
      ...describeInbound(this.line, msg, { parsed: null, body: null, violations: [] }),
      summary: detail, actions: [{ verb, detail }],
    });
  }

  /** A command the gateway sent, as the codec put it on the wire. */
  command(ident: MachineIdent, command: MachineCommand, wire: WireMessage): void {
    const jobId = typeof command.args.jobId === 'string' ? ` ${command.args.jobId}` : '';
    this.sink(this.outbound(ident, wire, MESSAGE_KIND.CMD, CHANNEL.CMD, command.op, `cmd ${command.op}${jobId} ${command.cmdId}`));
  }

  /** A receipt confirming the messages the gateway is done with. */
  receipt(ident: MachineIdent, ids: string[], wire: WireMessage): void {
    this.sink(this.outbound(ident, wire, 'receipt', RECEIPT_CHANNEL, null, `receipt for ${ids.length} message${ids.length === 1 ? '' : 's'}`));
  }

  private outbound(ident: MachineIdent, wire: WireMessage, kind: WireKind, channel: string, event: string | null, summary: string): WireEvent {
    const body = parseJson(wire.payload);
    return {
      type: WIRE_EVENT_TYPE, siteId: this.line.siteId, lineId: this.line.lineId, machineId: ident.machineId, address: addressOf(ident),
      direction: WIRE_DIRECTION.OUT, channel, topic: wire.topic, id: typeof body?.id === 'string' ? body.id : null,
      at: typeof body?.at === 'string' ? body.at : isoTs(), retained: false, kind, event, summary, violations: [], actions: [], payload: body ?? wire.payload,
    };
  }
}

function parseJson(payload: string): Record<string, any> | null {
  try {
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** The line-protocol channel a decoded message belongs to. */
function channelOf(seen: Inspection): string {
  const parsed = seen.parsed;
  if (!parsed) return '';
  switch (parsed.kind) {
    case MESSAGE_KIND.ALARM: return `${CHANNEL.ALARM}/${parsed.key ?? ''}`;
    case MESSAGE_KIND.REPORT: return `${CHANNEL.REPORT}/${parsed.key ?? ''}`;
    case MESSAGE_KIND.REPLY: return CHANNEL.REPLY;
    default: return parsed.kind;
  }
}

/** The event name within the kind: job event, alarm action, command op, reply status. */
export function eventOf(seen: Inspection): string | null {
  const parsed = seen.parsed;
  const b: Record<string, any> = seen.body?.body ?? {};
  if (!parsed) return null;
  switch (parsed.kind) {
    case MESSAGE_KIND.JOB: return typeof b.event === 'string' ? b.event : null;
    case MESSAGE_KIND.ALARM: return !seen.body || b.active === false ? ALARM_EVENT.CLEARED : b.ackedBy ? ALARM_EVENT.ACKED : ALARM_EVENT.RAISED;
    case MESSAGE_KIND.CMD: return typeof b.op === 'string' ? b.op : null;
    case MESSAGE_KIND.REPLY: return typeof b.status === 'string' ? b.status : null;
    case MESSAGE_KIND.PRESENCE: return b.online === true ? PRESENCE_EVENT.ONLINE : PRESENCE_EVENT.OFFLINE;
    case MESSAGE_KIND.SNAPSHOT: return typeof b.mode === 'string' ? b.mode : null;
    case MESSAGE_KIND.REPORT: return parsed.key ?? null;
    default: return null;
  }
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** One line from the kind, the event and the ids the body names. */
export function summarize(seen: Inspection): string {
  const parsed = seen.parsed;
  if (!parsed) return 'not a machine message';
  const b: Record<string, any> = seen.body?.body ?? {};
  const event = eventOf(seen);
  switch (parsed.kind) {
    case MESSAGE_KIND.PRESENCE:
      return ['presence', event, b.software, b.reason ? `(${b.reason})` : null].filter(Boolean).join(' ');
    case MESSAGE_KIND.SNAPSHOT:
      return ['snapshot', event, count(Array.isArray(b.jobs) ? b.jobs.length : 0, 'job'), Array.isArray(b.alarms) && b.alarms.length ? count(b.alarms.length, 'alarm') : null].filter(Boolean).join(' ');
    case MESSAGE_KIND.JOB:
      return ['job', event, b.unitId ?? (b.carrierId ? `carrier ${b.carrierId}` : null), b.jobId ? `(${b.jobId})` : null, b.result, b.failure].filter(Boolean).join(' ');
    case MESSAGE_KIND.ALARM:
      return ['alarm', event, parsed.key ?? b.alarmId, b.level, b.text ? `: ${b.text}` : null].filter(Boolean).join(' ');
    case MESSAGE_KIND.TELEMETRY:
      return `telemetry ${count(Object.keys(b.readings ?? {}).length, 'reading')}`;
    case MESSAGE_KIND.CMD:
      return ['cmd', event, b.args?.jobId, b.cmdId].filter(Boolean).join(' ');
    case MESSAGE_KIND.REPLY:
      return ['reply', event, b.cmdId, b.reason ? `: ${b.reason}` : null].filter(Boolean).join(' ');
    case MESSAGE_KIND.REPORT:
      return `report ${parsed.key ?? ''}`.trim();
    default:
      return parsed.kind;
  }
}

/** The record of an inbound message before the gateway's actions are known. */
export function describeInbound(line: WireLine, msg: InboundMessage, seen: Inspection, sender?: WireSender): Omit<WireEvent, 'actions'> {
  const ident = seen.parsed?.ident;
  return {
    type: WIRE_EVENT_TYPE, siteId: line.siteId, lineId: line.lineId,
    machineId: sender ? sender.machineId : ident?.machineId ?? null,
    address: sender ? sender.address : ident ? addressOf(ident) : null,
    direction: WIRE_DIRECTION.IN, channel: channelOf(seen), topic: msg.topic,
    id: seen.body?.id ?? null, at: seen.body?.at ?? isoTs(), retained: msg.retained === true,
    kind: seen.parsed?.kind ?? 'unknown', event: eventOf(seen), summary: summarize(seen),
    violations: seen.violations, payload: seen.body ?? msg.payload,
  };
}

/** What handling a message came to, as actions; a message with none is acknowledged, or waits for its row. */
export function appliedActions(applied: Applied, deliveries: number, maxDeliveries = MAX_DELIVERIES): WireAction[] {
  if (applied.actions.length) return applied.actions;
  if (applied.disposition !== DISPOSITION.NAK) return [{ verb: 'ack' }];
  if (applied.failed) return [{ verb: 'none', detail: 'a verb failed; the message is delivered again' }];
  if (deliveries >= maxDeliveries) return [{ verb: 'unmatched', detail: `no row after ${deliveries} deliveries` }];
  return [{ verb: 'none', detail: `waiting for its row (delivery ${deliveries})` }];
}

/** A message no row has claimed after this many deliveries is not racing its row. */
export const MAX_DELIVERIES = 30;

/** A planner action as the wire would record it, before it runs; a dry run shows these. */
export function plannedAction(a: Action): WireAction {
  switch (a.kind) {
    case 'dispatch': return { verb: 'none', detail: `dispatch ${a.args.jobId ?? a.cmdId} to ${a.machineId}` };
    case 'command': return { verb: 'none', detail: `${a.op} to ${a.machineId}` };
    case 'control': return { verb: 'none', rowId: a.rowId, detail: `${a.op} to ${a.machineId}` };
    case 'claim': return { verb: 'claim', rowId: a.rowId };
    case 'accumulate': return { verb: 'accumulate', rowId: a.rowId, itemKey: a.itemKey };
    case 'resolve': return { verb: 'resolve', rowId: a.rowId };
    case 'createAlarmRow': return { verb: 'create-row', detail: `${a.row.type} for ${a.machineId}` };
    case 'createRow': return { verb: 'create-row', detail: a.row.type };
    case 'watchOffline': return { verb: 'none', detail: `watching ${a.machineId} for an offline row` };
    case 'settleReply': return { verb: 'ack', detail: `${a.status} ${a.cmdId}` };
    case 'settleSnapshot': return { verb: 'ack', detail: `${a.machineId} holds ${count(a.jobIds.length, 'job')}` };
    case 'bindAddress': return { verb: 'ack', detail: `bind ${a.machineId} to ${a.address}` };
    case 'refuseBinding': return { verb: 'refuse', detail: a.reason };
  }
}
