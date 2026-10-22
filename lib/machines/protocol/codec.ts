/**
 * The wire, behind one seam. A codec turns a machine's MQTT messages into
 * the line protocol's events (topics.ts, contract.ts) and the gateway's
 * commands back into MQTT messages. The gateway, the rows and the workflow
 * only ever see the line protocol. The generic codec speaks it natively; a
 * host whose machines speak another protocol supplies a codec for it.
 */

import type { LineDef } from '../../../types/machines';
import { CHANNEL, JOB_EVENT } from './constants';
import { inspectMessage, type Inspection } from './contract';
import { buildEnvelope, type Envelope, type MachineIdent } from './envelope';
import { MESSAGE_KIND, machineTopic } from './topics';

export interface WireMessage {
  topic: string;
  payload: string;
}

export interface MachineCommand {
  cmdId: string;
  op: string;
  args: Record<string, unknown>;
}

/** MQTT filters under each machine's topic, e.g. `job` or `alarm/+`. */
export interface CodecChannels {
  /** Messages the gateway acts on; kept in the durable event stream. */
  events: string[];
  /** Readings that only prove a machine is alive; read live. */
  telemetry: string[];
  /** Where a machine reads its commands; only the line controller writes them. */
  commands: string[];
}

/** Which topics a filter covers: a level left out matches any (`+`). */
export interface TopicScope {
  siteId?: string;
  lineId?: string;
  /** The machine's wire address (`MachineDef.address`, else its id). */
  address?: string;
}

export interface LineCodec {
  readonly root: string;
  readonly channels: CodecChannels;
  /**
   * The topic of one machine channel. Defaults to `{root}/{site}/{line}/{address}/{channel}`.
   * A layout must begin with `{root}/{site}/{line}/`, the prefix the line's subscription and
   * retained reads use; the ACL and stream subjects are built from this.
   */
  topicFor?(scope: TopicScope, channel: string): string;
  /** Most units one dispatch may carry; the gateway sends one dispatch per unit when 1. Null: any. */
  readonly unitsPerDispatch: number | null;
  /**
   * When a handoff's job goes to its receiver: as soon as the row exists (the default), or once every
   * unit has arrived there, for machines that take work only for units they have scanned in. Each
   * dispatched unit then carries the arrival event its receiver reported.
   */
  readonly dispatchOn?: DispatchOn;
  /**
   * Strict: a message with contract violations is confirmed but never acted on, and a row shows it
   * to a person. Otherwise (the default) known fields are acted on and the violations are logged.
   */
  readonly strict?: boolean;
  /** One wire message as zero or more line-protocol messages; empty when the topic is not a machine's. */
  decode(topic: string, payload: string, retained?: boolean): Inspection[];
  /** The command as wire messages; none when the machines have no such command, and the gateway then sends nothing. */
  encode(ident: MachineIdent, command: MachineCommand): WireMessage[];
  /**
   * The receipt confirming messages the gateway is done with (each decoded with a `receiptId`), for
   * machines that keep an outbox until confirmed. Absent: no receipts are sent.
   */
  receipt?(ident: MachineIdent, messageIds: string[]): WireMessage[];
}

export const DISPATCH_ON = { CREATED: 'created', ARRIVAL: 'arrival' } as const;
export type DispatchOn = typeof DISPATCH_ON[keyof typeof DISPATCH_ON];

/** Which job event counts as the receiver's receipt. */
export const RECEIPT_FROM = { ARRIVED: 'arrived', BOUND: 'bound', STARTED: 'started' } as const;
export type ReceiptFrom = typeof RECEIPT_FROM[keyof typeof RECEIPT_FROM];

export interface GenericCodecOptions {
  root: string;
  /** Maps topic levels back to machine ids for machines whose `address` differs from their id. */
  line?: Pick<LineDef, 'machines'>;
  /** For machines that report no arrival: treat the receiver's carrier bind or job start as the receipt. */
  receiptFrom?: ReceiptFrom;
  unitsPerDispatch?: number | null;
  dispatchOn?: DispatchOn;
}

export const GENERIC_CHANNELS: CodecChannels = {
  events: [CHANNEL.PRESENCE, CHANNEL.SNAPSHOT, CHANNEL.JOB, `${CHANNEL.ALARM}/+`, CHANNEL.REPLY, `${CHANNEL.REPORT}/#`],
  telemetry: [CHANNEL.TELEMETRY],
  commands: [CHANNEL.CMD],
};

/** The topic of one machine channel under the codec's layout. */
export function topicOf(codec: Pick<LineCodec, 'root' | 'topicFor'>, scope: TopicScope, channel: string): string {
  if (codec.topicFor) return codec.topicFor(scope, channel);
  const level = (v?: string) => v ?? '+';
  return `${codec.root}/${level(scope.siteId)}/${level(scope.lineId)}/${level(scope.address)}/${channel}`;
}

/** Topic level to machine id, for the machines whose address is not their id. */
function addressMap(line?: Pick<LineDef, 'machines'>): Map<string, string> {
  return new Map((line?.machines ?? []).filter((m) => m.address && m.address !== m.machineId).map((m) => [m.address!, m.machineId]));
}

/** The inspection with the topic's address read back as the machine id. */
function atMachine(seen: Inspection, ids: Map<string, string>): Inspection {
  const machineId = seen.parsed && ids.get(seen.parsed.ident.machineId);
  if (!machineId) return seen;
  const ident = { ...seen.parsed!.ident, machineId, address: seen.parsed!.ident.machineId };
  return { ...seen, parsed: { ...seen.parsed!, ident } };
}

function withEvent(seen: Inspection, event: string): Inspection {
  const body = seen.body as Envelope;
  return { ...seen, body: { ...body, body: { ...body.body, event } } };
}

/** Another event as the receipt: the arrival first, then that event; reported arrivals are dropped. */
function inferReceipt(seen: Inspection, from: ReceiptFrom): Inspection[] {
  if (seen.parsed?.kind !== MESSAGE_KIND.JOB || !seen.body) return [seen];
  const event = seen.body.body?.event;
  if (event === JOB_EVENT.ARRIVED) return [];
  if (event === from) return [withEvent(seen, JOB_EVENT.ARRIVED), seen];
  return [seen];
}

export function genericCodec(opts: GenericCodecOptions): LineCodec {
  const receiptFrom = opts.receiptFrom ?? RECEIPT_FROM.ARRIVED;
  const ids = addressMap(opts.line);
  return {
    root: opts.root,
    channels: GENERIC_CHANNELS,
    unitsPerDispatch: opts.unitsPerDispatch ?? null,
    dispatchOn: opts.dispatchOn ?? DISPATCH_ON.CREATED,
    decode(topic, payload, retained) {
      const seen = atMachine(inspectMessage(opts.root, topic, payload, retained), ids);
      if (!seen.parsed) return [];
      return receiptFrom === RECEIPT_FROM.ARRIVED ? [seen] : inferReceipt(seen, receiptFrom);
    },
    encode(ident, command) {
      return [{ topic: machineTopic(opts.root, ident, CHANNEL.CMD), payload: JSON.stringify(buildEnvelope(ident, command)) }];
    },
  };
}
