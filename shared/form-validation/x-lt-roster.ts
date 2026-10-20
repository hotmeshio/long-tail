/**
 * x-lt-roster: every member a container row expects, each with its state.
 * A form field declares `x-lt-widget: "roster"` and an `x-lt-roster` block:
 *
 *   "x-lt-roster": {
 *     "expected": { "query": { "roles": ["packing"], "facets": { "box": "{{escalation.id}}" } } },
 *     "key": "{{metadata.orderId}}",
 *     "in": ["items", "resolver.bags"],
 *     "flagged": [{ "when": "resolver.outcome=missing", "label": "Missing" }]
 *   }
 *
 * The expected set is one of:
 *   - `query`: member rows matched by role(s) and facets, any status unless
 *     `status` narrows it. `key` names each row's entry (default its id).
 *   - `list`: a `domain.path` naming an array of keys on the host row.
 *   - `batch`: the host row's batch keys; `labels` names a per-key map.
 *
 * An entry is `in` when its key is held by the host row (`items`: the
 * accumulated keys, or a batch's filled keys) or appears in a named context
 * value (`resolver.<field>`, a string or an array). It is `flagged` when its
 * member row matches a `flagged` rule, and `waiting` otherwise. In wins over
 * flagged, so a member flagged on its own row and then added reads in.
 *
 * Isomorphic: the dashboard renders the widget and the form's `roster.*`
 * context from it, and the API layer computes the same counts to evaluate
 * showIf and the roster submit guard at resolve.
 */
import { getDeep } from './x-lt-bind';
import { resolveCtxPath } from './ctx-path';
import { interpolateHelp, type HelpTokenContext } from './x-lt-help';
import { evaluateShowIf } from './x-lt-show-if';

export const X_LT_ROSTER = 'x-lt-roster';
export const ROSTER_WIDGET = 'roster';
/** The context domain the counts are read from: `roster.<field>.outstanding`. */
export const ROSTER_DOMAIN = 'roster';
/** The most member rows a query set reads. */
export const ROSTER_QUERY_LIMIT = 200;
/** The `in` source naming the host row's held keys. */
export const ROSTER_ITEMS_SOURCE = 'items';
/** `query.status` value that reads every status (the default). */
export const ROSTER_ANY_STATUS = 'any';

export const ROSTER_STATES = { WAITING: 'waiting', IN: 'in', FLAGGED: 'flagged' } as const;
export type RosterState = (typeof ROSTER_STATES)[keyof typeof ROSTER_STATES];

export interface RosterQuery {
  role?: string;
  roles?: string[];
  facets?: Record<string, string>;
  /** A status to narrow to; omitted or `any` reads every status. */
  status?: string;
}

export type RosterExpected =
  | { query: RosterQuery }
  | { list: string }
  | { batch: true; labels?: string };

export interface RosterFlagRule {
  /** An x-lt-showIf condition over the member row's own context. */
  when: string | string[];
  label: string;
}

export interface RosterDef {
  expected: RosterExpected;
  key?: string;
  in?: string[];
  flagged?: RosterFlagRule[];
}

/** One member row's token context (the row's own domains). */
export type RosterRow = HelpTokenContext & { escalation: Record<string, unknown> };

export interface RosterEntry {
  key: string;
  state: RosterState;
  /** The matching flag rule's label, when flagged. */
  flag?: string;
  /** The member row, for a query set. */
  row?: RosterRow;
  /** The per-key label value from a batch's `labels` map. */
  label?: unknown;
}

export interface RosterCounts {
  expected: number;
  in: number;
  flagged: number;
  waiting: number;
  /** Entries neither in nor flagged: the count a roster guard waits on. */
  outstanding: number;
}

export interface RosterResult {
  entries: RosterEntry[];
  counts: RosterCounts;
}

const DEFAULT_KEY = '{{escalation.id}}';
const MISSING = '—';
const BATCH_KEYS = 'batch_keys';
const BATCH_PENDING = 'batch_pending';
const ACCUMULATE_KEYS = 'accumulate_keys';

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function strings(v: unknown): string[] {
  if (typeof v === 'string') return v ? [v] : [];
  if (!Array.isArray(v)) return [];
  return v.filter((s): s is string => typeof s === 'string' && s.length > 0);
}

/** The field's roster declaration, or undefined when it declares none or an unusable one. */
export function readRosterDef(fieldSchema: Record<string, unknown> | null | undefined): RosterDef | undefined {
  const raw = fieldSchema?.[X_LT_ROSTER];
  if (!isRecord(raw) || !isRecord(raw.expected)) return undefined;
  const e = raw.expected;
  const hasSource = isRecord(e.query) || typeof e.list === 'string' || e.batch === true;
  return hasSource ? (raw as unknown as RosterDef) : undefined;
}

/** Every roster field of a form schema, by field name. */
export function readRosterDefs(schema: Record<string, unknown> | null | undefined): Record<string, RosterDef> {
  const properties = isRecord(schema?.properties) ? (schema!.properties as Record<string, unknown>) : {};
  const defs: Record<string, RosterDef> = {};
  for (const [field, def] of Object.entries(properties)) {
    const roster = isRecord(def) ? readRosterDef(def) : undefined;
    if (roster) defs[field] = roster;
  }
  return defs;
}

/** The roster's member-row query, or null when its set is not a query. */
export function rosterQueryOf(def: RosterDef): RosterQuery | null {
  return 'query' in def.expected && isRecord(def.expected.query) ? def.expected.query : null;
}

/** The query's concrete params: facets interpolated, `any` status dropped. Null when the scope is empty. */
export function resolveRosterQuery(
  query: RosterQuery,
  ctx: HelpTokenContext,
): { roles?: string[]; facets: Record<string, string>; status?: string; limit: number } | null {
  const facets: Record<string, string> = {};
  for (const [k, v] of Object.entries(query.facets ?? {})) {
    if (typeof v !== 'string') continue;
    const resolved = interpolateHelp(v, ctx);
    if (!resolved || resolved === MISSING) return null;
    facets[k] = resolved;
  }
  const roles = [...(query.role ? [query.role] : []), ...strings(query.roles)];
  if (!roles.length && !Object.keys(facets).length) return null;
  const status = query.status && query.status !== ROSTER_ANY_STATUS ? query.status : undefined;
  return { ...(roles.length ? { roles } : {}), facets, ...(status ? { status } : {}), limit: ROSTER_QUERY_LIMIT };
}

function parseJson(v: unknown): Record<string, unknown> | null {
  if (isRecord(v)) return v;
  if (typeof v !== 'string' || !v) return null;
  try {
    const parsed = JSON.parse(v);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** A member row's token context, from a row whose JSON columns are strings or objects. */
export function rosterRowContext(row: Record<string, unknown>): RosterRow {
  return {
    escalation: row,
    metadata: isRecord(row.metadata) ? row.metadata : parseJson(row.metadata),
    envelope: parseJson(row.envelope),
    payload: parseJson(row.escalation_payload),
    resolver: parseJson(row.resolver_payload),
  };
}

/** The keys the host row holds: its accumulated keys, or a batch's filled keys. */
function heldKeys(ctx: HelpTokenContext): Set<string> {
  const metadata = ctx.metadata ?? {};
  const accumulated = metadata[ACCUMULATE_KEYS];
  if (Array.isArray(accumulated)) return new Set(strings(accumulated));
  const envelopeItems = getDeep(ctx.envelope, 'accumulate_items');
  if (isRecord(envelopeItems)) return new Set(Object.keys(envelopeItems));
  if (Array.isArray(metadata[BATCH_PENDING])) {
    const pending = new Set(strings(metadata[BATCH_PENDING]));
    return new Set(strings(metadata[BATCH_KEYS]).filter((k) => !pending.has(k)));
  }
  return new Set();
}

function arrivedKeys(def: RosterDef, ctx: HelpTokenContext): Set<string> {
  const arrived = new Set<string>();
  for (const source of def.in ?? [ROSTER_ITEMS_SOURCE]) {
    const keys = source === ROSTER_ITEMS_SOURCE
      ? [...heldKeys(ctx)]
      : strings(resolveCtxPath(source, ctx as Record<string, unknown>));
    keys.forEach((k) => arrived.add(k));
  }
  return arrived;
}

function flagFor(def: RosterDef, row: RosterRow | undefined): string | undefined {
  if (!row) return undefined;
  for (const rule of def.flagged ?? []) {
    const conditions = strings(rule.when);
    if (!conditions.length || typeof rule.label !== 'string') continue;
    if (evaluateShowIf(conditions, row)) return rule.label;
  }
  return undefined;
}

/** A row's creation instant in ms; 0 when absent or unreadable. */
function createdAt(row: RosterRow): number {
  const raw = row.escalation.created_at;
  const ms = raw instanceof Date ? raw.getTime() : typeof raw === 'string' ? Date.parse(raw) : NaN;
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * The expected keys in order, each with its member row (query) or label
 * (batch). Several rows sharing a key (a member that parked again) read as
 * one entry on the newest row, so its state and actions follow the live row.
 */
function expectedEntries(
  def: RosterDef,
  ctx: HelpTokenContext,
  rows: RosterRow[],
): Array<{ key: string; row?: RosterRow; label?: unknown }> {
  const seen = new Set<string>();
  const out: Array<{ key: string; row?: RosterRow; label?: unknown }> = [];
  const push = (key: string, extra: { row?: RosterRow; label?: unknown } = {}) => {
    if (!key || key === MISSING || seen.has(key)) return;
    seen.add(key);
    out.push({ key, ...extra });
  };
  const e = def.expected;
  if ('query' in e) {
    const template = def.key ?? DEFAULT_KEY;
    const newest = new Map<string, RosterRow>();
    for (const row of rows) {
      const key = interpolateHelp(template, row);
      const held = newest.get(key);
      if (!held || createdAt(row) > createdAt(held)) newest.set(key, row);
    }
    for (const row of rows) {
      const key = interpolateHelp(template, row);
      push(key, { row: newest.get(key) });
    }
  } else if ('list' in e) {
    strings(resolveCtxPath(e.list, ctx as Record<string, unknown>)).forEach((k) => push(k));
  } else {
    const labels = e.labels ? resolveCtxPath(e.labels, ctx as Record<string, unknown>) : undefined;
    for (const key of strings(ctx.metadata?.[BATCH_KEYS])) {
      push(key, isRecord(labels) && key in labels ? { label: labels[key] } : {});
    }
  }
  return out;
}

/**
 * Every expected entry with its state, and the counts. `rows` are the
 * member rows a query set read (ignored for list and batch sets). `ctx` is
 * the host row's context with the live form values under `resolver`.
 */
export function computeRoster(def: RosterDef, ctx: HelpTokenContext, rows: RosterRow[] = []): RosterResult {
  const arrived = arrivedKeys(def, ctx);
  const entries: RosterEntry[] = expectedEntries(def, ctx, rows).map((e) => {
    if (arrived.has(e.key)) return { ...e, state: ROSTER_STATES.IN };
    const flag = flagFor(def, e.row);
    return flag ? { ...e, state: ROSTER_STATES.FLAGGED, flag } : { ...e, state: ROSTER_STATES.WAITING };
  });
  const count = (s: RosterState) => entries.filter((e) => e.state === s).length;
  const waiting = count(ROSTER_STATES.WAITING);
  return {
    entries,
    counts: {
      expected: entries.length,
      in: count(ROSTER_STATES.IN),
      flagged: count(ROSTER_STATES.FLAGGED),
      waiting,
      outstanding: waiting,
    },
  };
}

/** The header line: "3 of 5 in · 1 Missing". */
export function rosterHeadline(result: RosterResult): string {
  const { counts } = result;
  const parts = [`${counts.in} of ${counts.expected} in`];
  const byFlag = new Map<string, number>();
  for (const e of result.entries) {
    if (e.state === ROSTER_STATES.FLAGGED && e.flag) byFlag.set(e.flag, (byFlag.get(e.flag) ?? 0) + 1);
  }
  for (const [flag, n] of byFlag) parts.push(`${n} ${flag}`);
  return parts.join(' · ');
}
