/**
 * The wire, behind one seam. A codec turns a machine's MQTT messages into
 * the line protocol's events (topics.ts, contract.ts) and the gateway's
 * commands back into MQTT messages. The gateway, the rows and the workflow
 * only ever see the line protocol. The generic codec speaks it natively; a
 * host whose machines speak another protocol supplies a codec for it.
 */

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
}

export interface LineCodec {
  readonly root: string;
  readonly channels: CodecChannels;
  /** Most units one dispatch may carry; the gateway sends one dispatch per unit when 1. Null: any. */
  readonly unitsPerDispatch: number | null;
  /** One wire message as zero or more line-protocol messages; empty when the topic is not a machine's. */
  decode(topic: string, payload: string, retained?: boolean): Inspection[];
  encode(ident: MachineIdent, command: MachineCommand): WireMessage[];
}

/** Which job event counts as the receiver's receipt. */
export const RECEIPT_FROM = { ARRIVED: 'arrived', STARTED: 'started' } as const;
export type ReceiptFrom = typeof RECEIPT_FROM[keyof typeof RECEIPT_FROM];

export interface GenericCodecOptions {
  root: string;
  /** For machines that report no arrival: treat the receiver's job start as the receipt. */
  receiptFrom?: ReceiptFrom;
  unitsPerDispatch?: number | null;
}

export const GENERIC_CHANNELS: CodecChannels = {
  events: [CHANNEL.PRESENCE, CHANNEL.SNAPSHOT, CHANNEL.JOB, `${CHANNEL.ALARM}/+`, CHANNEL.REPLY],
  telemetry: [CHANNEL.TELEMETRY],
};

function withEvent(seen: Inspection, event: string): Inspection {
  const body = seen.body as Envelope;
  return { ...seen, body: { ...body, body: { ...body.body, event } } };
}

/** A receiver's start as its receipt: the arrival first, then the start; reported arrivals are dropped. */
function inferReceipt(seen: Inspection): Inspection[] {
  if (seen.parsed?.kind !== MESSAGE_KIND.JOB || !seen.body) return [seen];
  const event = seen.body.body?.event;
  if (event === JOB_EVENT.ARRIVED) return [];
  if (event === JOB_EVENT.STARTED) return [withEvent(seen, JOB_EVENT.ARRIVED), seen];
  return [seen];
}

export function genericCodec(opts: GenericCodecOptions): LineCodec {
  const receiptFrom = opts.receiptFrom ?? RECEIPT_FROM.ARRIVED;
  return {
    root: opts.root,
    channels: GENERIC_CHANNELS,
    unitsPerDispatch: opts.unitsPerDispatch ?? null,
    decode(topic, payload, retained) {
      const seen = inspectMessage(opts.root, topic, payload, retained);
      if (!seen.parsed) return [];
      return receiptFrom === RECEIPT_FROM.STARTED ? inferReceipt(seen) : [seen];
    },
    encode(ident, command) {
      return [{ topic: machineTopic(opts.root, ident, CHANNEL.CMD), payload: JSON.stringify(buildEnvelope(ident, command)) }];
    },
  };
}
