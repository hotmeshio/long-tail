import { CHANNEL, buildEnvelope, genericCodec, machineTopic, type AnswerRequest, type LineCodec, type NoticeRequest, type RowOp } from '../../lib/machines/protocol';
import { identOf, type LineDef } from '../../lib/machines/line';
import { DEFAULT_LINE } from '../../examples/workflows/machine-line/line';
import { ROOT } from './machine-line-fixtures';
import type { LineRig } from './machine-line-gateway-harness';

export const ACK_OP = 'material-ack';
export const RECEIVED = 'material-received';

export interface RequestCodecOptions {
  answer?: Partial<AnswerRequest>;
  /** The report is a notice instead; with `answer` too, it carries both. */
  notice?: NoticeRequest;
  rowOps?: RowOp[];
  /** The codec has a message for the answer op. */
  encodes?: boolean;
}

/** The generic protocol, where a `report/material-received` asks the host for an answer and is confirmed by receipt. */
export function requestCodec(opts: RequestCodecOptions = {}): LineCodec {
  const base = genericCodec({ root: ROOT });
  return {
    ...base,
    rowOps: opts.rowOps ?? [{ op: ACK_OP, reply: false }],
    decode: (topic, payload, retained) => base.decode(topic, payload, retained).map((seen) => {
      if (seen.parsed?.kind !== 'report' || !topic.endsWith(RECEIVED) || !seen.body) return seen;
      const answer = !opts.notice || opts.answer ? { answer: { op: ACK_OP, ...opts.answer } } : {};
      return { ...seen, receiptId: seen.body.id, ...answer, ...(opts.notice ? { notice: opts.notice } : {}) };
    }),
    encode: (ident, command) => (opts.encodes === false && command.op === ACK_OP ? [] : base.encode(ident, command)),
    receipt: (ident, ids) => [{ topic: machineTopic(ROOT, ident, 'receipt'), payload: JSON.stringify({ ids }) }],
  };
}

/** A machine reports a material it was handed; returns the message id. Send the same envelope again with `again`. */
export function reportReceived(rig: LineRig, machineId = 'press-01', again?: string, line: LineDef = DEFAULT_LINE): string {
  const ident = identOf(line, machineId);
  const env = buildEnvelope(ident, { message_name: RECEIVED, tag: 'EPC-1' }, again ? { id: again } : {});
  rig.broker.publish(machineTopic(ROOT, ident, `${CHANNEL.REPORT}/${RECEIVED}`), JSON.stringify(env));
  return env.id;
}

export function watchReceipts(rig: LineRig): string[] {
  const ids: string[] = [];
  rig.broker.connect('receipts');
  rig.broker.subscribe('receipts', `${ROOT}/+/+/+/receipt`, (msg) => ids.push(...JSON.parse(msg.payload).ids));
  return ids;
}
