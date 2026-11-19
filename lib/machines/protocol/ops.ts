/**
 * The commands a codec declares: the line protocol's control ops its machines
 * have, a snapshot, and its own row ops, each with its reply mode, argument
 * schema and settle window. A declaration that cannot be read throws, so a
 * misconfigured codec stops the gateway at startup.
 */

import { CONTROL_OPS, OP, type Op } from './constants';
import type { LineCodec, RowOp, RowOpEntry } from './codec';

type DeclaresOps = Pick<LineCodec, 'rowOps' | 'controlOps'>;

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function entryOf(entry: RowOp): RowOpEntry {
  if (typeof entry === 'string') return { op: entry };
  if (!isPlainObject(entry)) throw new Error('codec.rowOps entries must each name a non-empty op');
  return entry as unknown as RowOpEntry;
}

/** The codec's row ops in full; an entry that cannot be read throws. */
export function rowOpEntries(codec: Pick<LineCodec, 'rowOps'>): RowOpEntry[] {
  const ops = codec.rowOps ?? [];
  if (!Array.isArray(ops)) throw new Error('codec.rowOps must be a list of op names or { op, reply, args, settleMs } entries');
  const entries = ops.map(entryOf);
  for (const e of entries) {
    if (typeof e.op !== 'string' || !e.op) throw new Error('codec.rowOps entries must each name a non-empty op');
    if (e.args !== undefined && !isPlainObject(e.args)) throw new Error(`codec.rowOps ${e.op}: args must be a JSON Schema object`);
    if (e.settleMs === undefined) continue;
    if (!Number.isInteger(e.settleMs) || e.settleMs <= 0) throw new Error(`codec.rowOps ${e.op}: settleMs must be a positive integer`);
    if (e.reply === false) throw new Error(`codec.rowOps ${e.op}: a one-way op (reply: false) has no reply to settle`);
  }
  return entries;
}

/** The names of the codec's own row ops. */
export function declaredRowOps(codec: Pick<LineCodec, 'rowOps'>): readonly string[] {
  return rowOpEntries(codec).map((e) => e.op);
}

/** The row ops the machines never reply to: sent once, done on publish. */
export function oneWayOps(codec: Pick<LineCodec, 'rowOps'>): ReadonlySet<string> {
  return new Set(rowOpEntries(codec).filter((e) => e.reply === false).map((e) => e.op));
}

/** The control ops the machines have; every one the line protocol defines unless the codec names fewer. */
export function declaredControlOps(codec: Pick<LineCodec, 'controlOps'>): readonly Op[] {
  const ops = codec.controlOps ?? CONTROL_OPS;
  if (!Array.isArray(ops)) throw new Error('codec.controlOps must be a list of control ops');
  const unknown = ops.filter((op) => !CONTROL_OPS.includes(op));
  if (unknown.length) throw new Error(`codec.controlOps names ${unknown.join(', ')}; each must be one of ${CONTROL_OPS.join(', ')}`);
  return ops;
}

/** Every op a machine-command row may ask for: the control ops, a snapshot, and the codec's own. */
export function commandOpsOf(codec: DeclaresOps): string[] {
  return [...new Set<string>([...declaredControlOps(codec), OP.SNAPSHOT, ...declaredRowOps(codec)])];
}

/** The argument schema each row op declares. */
export function rowOpArgs(codec: Pick<LineCodec, 'rowOps'>): Record<string, Record<string, unknown>> {
  return Object.fromEntries(rowOpEntries(codec).filter((e) => e.args).map((e) => [e.op, e.args!]));
}

/** The settle window each row op declares, in ms. */
export function rowOpSettleMs(codec: Pick<LineCodec, 'rowOps'>): Record<string, number> {
  return Object.fromEntries(rowOpEntries(codec).filter((e) => e.settleMs !== undefined).map((e) => [e.op, e.settleMs!]));
}
