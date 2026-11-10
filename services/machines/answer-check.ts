/**
 * An answer is checked when it is added to a request row, not only when it
 * is sent: the line's codec encodes it as a dry run, so an answer the
 * machines could never receive is refused at the person or workflow that
 * added it. `encode` must be free of side effects for this to hold.
 */

import { identOf, type LineDef } from '../../lib/machines/line';
import type { LineCodec, MachineIdent } from '../../lib/machines/protocol';
import { REQUEST_ITEM, answerCommandId } from './contracts';
import { readRequestFacets } from './requests';

/** What a replica knows about a line it runs. */
export interface AnswerLine {
  line: LineDef;
  codec: LineCodec;
  /** The ops an answer may be sent as. */
  ops: readonly string[];
  /** Where the line's leader would send to a machine; its declared address otherwise. */
  ident?: (machineId: string) => MachineIdent;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Why an item cannot answer its request row; null when it can, when it is not
 * the answer, or when this replica does not run the row's line (the gateway
 * checks again when it sends).
 */
export function answerRefusal(
  row: { id: string; metadata?: Record<string, any> | null },
  itemKey: string,
  payload: Record<string, any> | undefined,
  lineOf: (siteId: string, lineId: string) => AnswerLine | undefined,
): string | null {
  if (itemKey !== REQUEST_ITEM.ANSWER) return null;
  const facets = readRequestFacets(row.metadata ?? {});
  if (!facets) return null;
  const run = lineOf(facets.siteId, facets.lineId);
  if (!run) return null;

  // 1. The answer's shape
  const args = payload?.args ?? {};
  if (!isPlainObject(args)) return 'an answer\'s args must be an object';
  if (payload?.op !== undefined && (typeof payload.op !== 'string' || !payload.op)) return 'an answer\'s op must name a command';
  const op: string = payload?.op ?? facets.op;
  if (!run.ops.includes(op)) return `${op} is not a command an answer may be sent as; one of ${run.ops.join(', ')}`;
  if (!run.line.machines.some((m) => m.machineId === facets.machineId)) return `${facets.machineId} is not a machine on line ${facets.lineId}`;

  // 2. The codec's dry run
  const ident = run.ident?.(facets.machineId) ?? identOf(run.line, facets.machineId);
  try {
    const wires = run.codec.encode(ident, { cmdId: answerCommandId(row.id), op, args, respondingTo: facets.ref });
    return wires.length ? null : `the line's codec has no ${op} command for this answer`;
  } catch (err) {
    return `the line's codec refused the answer: ${(err as Error).message}`;
  }
}
