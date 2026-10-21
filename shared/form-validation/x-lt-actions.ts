/**
 * x-lt-actions on a roster field: the acts an entry offers, read the same way
 * by the dashboard (which shows them) and the API (which runs them). Each
 * action is exactly one act:
 *
 *   { "label": "Missing",      "resolverPayload": { "outcome": "missing" } }  resolve the member row
 *   { "label": "Key in",       "fill": { "payload": { "source": "key-in" }, "enterCode": true } }
 *   { "label": "Missing",      "flag": { "label": "Missing" } }               flag the batch key
 *   { "label": "Found it",     "unflag": true }                               clear the flag
 *
 * `when` names the entry states that offer it. `roles` limits who may run it:
 * the action shows to everyone and runs only for a person holding one of the
 * roles; `refuse` is what anyone else is told. The server re-reads the action
 * from the row's form schema and decides; the dashboard only displays.
 */
import { interpolateHelp, type HelpTokenContext } from './x-lt-help';
import { ROSTER_STATES, type RosterEntry, type RosterState } from './x-lt-roster';
import { displayGtin, isValidGtin, normalizeGtin } from '../scan-code/gtin';

export const X_LT_ACTIONS = 'x-lt-actions';

export const ROSTER_ACTION_KINDS = {
  RESOLVE: 'resolve',
  FILL: 'fill',
  FLAG: 'flag',
  UNFLAG: 'unflag',
} as const;
export type RosterActionKind = (typeof ROSTER_ACTION_KINDS)[keyof typeof ROSTER_ACTION_KINDS];

/** The separator of counted batch keys when the roster names none. */
export const ROSTER_KEY_SEPARATOR_DEFAULT = '#';

/** The payload key a key-in records the entered code under. */
export const ENTERED_CODE_KEY = 'enteredCode';

export interface RosterActionDef {
  label: string;
  /** The entry states that offer it; the default follows the act. */
  when?: RosterState | RosterState[];
  /** A confirmation asked in place before firing; tokens interpolate per entry. */
  confirm?: string;
  /** Resolve the entry's member row with this canned payload (a query set). */
  resolverPayload?: Record<string, unknown>;
  /** Fill the entry's batch key; `enterCode` asks for the code and checks it against the key. */
  fill?: { payload?: Record<string, unknown>; enterCode?: boolean };
  /** Flag the entry's batch key. */
  flag?: { label: string; payload?: Record<string, unknown> };
  /** Clear the entry's flag. */
  unflag?: true;
  /** Runs only for a person holding one of these roles. */
  roles?: string[];
  /** What a person without the roles is told. */
  refuse?: string;
}

const DEFAULT_WHEN: Record<RosterActionKind, RosterState[]> = {
  resolve: [ROSTER_STATES.WAITING],
  fill: [ROSTER_STATES.WAITING, ROSTER_STATES.FLAGGED],
  flag: [ROSTER_STATES.WAITING],
  unflag: [ROSTER_STATES.FLAGGED],
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** The one act an action declares, or null when it declares none or several. */
export function rosterActionKind(action: RosterActionDef): RosterActionKind | null {
  const kinds: RosterActionKind[] = [];
  if (isRecord(action.resolverPayload)) kinds.push(ROSTER_ACTION_KINDS.RESOLVE);
  if (isRecord(action.fill)) kinds.push(ROSTER_ACTION_KINDS.FILL);
  if (isRecord(action.flag) && typeof action.flag.label === 'string' && action.flag.label) {
    kinds.push(ROSTER_ACTION_KINDS.FLAG);
  }
  if (action.unflag === true) kinds.push(ROSTER_ACTION_KINDS.UNFLAG);
  return kinds.length === 1 ? kinds[0] : null;
}

/** The field's actions with a label and exactly one act, in declared order. */
export function readRosterActions(fieldSchema: Record<string, unknown> | null | undefined): RosterActionDef[] {
  const raw = fieldSchema?.[X_LT_ACTIONS];
  if (!Array.isArray(raw)) return [];
  return raw.filter((a): a is RosterActionDef =>
    isRecord(a) && typeof a.label === 'string' && !!a.label && rosterActionKind(a as unknown as RosterActionDef) !== null);
}

/**
 * True when the entry offers the action: the entry is in one of its states,
 * and the act fits the entry (a resolve needs a member row; batch acts need
 * a batch set).
 */
export function offersAction(action: RosterActionDef, entry: RosterEntry, batch: boolean): boolean {
  const kind = rosterActionKind(action);
  if (!kind) return false;
  if (kind === ROSTER_ACTION_KINDS.RESOLVE ? !entry.row : !batch) return false;
  const when = action.when === undefined ? DEFAULT_WHEN[kind]
    : Array.isArray(action.when) ? action.when : [action.when];
  return when.includes(entry.state);
}

/** True when a person holding `roles` may run the action. */
export function holdsActionRole(action: Pick<RosterActionDef, 'roles'>, roles: string[], superadmin = false): boolean {
  const required = Array.isArray(action.roles) ? action.roles.filter((r) => typeof r === 'string' && r) : [];
  return required.length === 0 || superadmin || required.some((r) => roles.includes(r));
}

/** What a person without the action's roles is told. */
export function actionRefusal(action: Pick<RosterActionDef, 'label' | 'roles' | 'refuse'>): string {
  if (typeof action.refuse === 'string' && action.refuse.trim()) return action.refuse;
  const roles = (action.roles ?? []).filter(Boolean);
  return `${action.label} needs ${roles.length > 1 ? 'one of these roles' : 'the role'}: ${roles.join(', ')}.`;
}

/** Deep-walk a payload template: string leaves interpolate against the context; other types pass through typed. */
export function interpolatePayload(value: unknown, ctx: HelpTokenContext): unknown {
  if (typeof value === 'string') return interpolateHelp(value, ctx);
  if (Array.isArray(value)) return value.map((v) => interpolatePayload(v, ctx));
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, interpolatePayload(v, ctx)]));
  }
  return value;
}

/** The code a batch key names, without its ordinal suffix. */
export function batchKeyCode(key: string, separator = ROSTER_KEY_SEPARATOR_DEFAULT): string {
  const at = key.lastIndexOf(separator);
  return at > 0 && /^[0-9]+$/.test(key.slice(at + 1)) ? key.slice(0, at) : key;
}

/** The batch key's code as its label prints it: a GTIN in its EAN-13 or EAN-8 form. */
export function printedKeyCode(key: string, separator?: string): string {
  const code = batchKeyCode(key, separator);
  return isValidGtin(code) ? displayGtin(normalizeGtin(code)) : code;
}

/**
 * True when an entered code names the batch key's code. GTINs compare in
 * their 14-digit form, so a UPC-A typed from the label matches its GTIN-14
 * key; anything else compares as trimmed text.
 */
export function enteredCodeMatches(entered: string, key: string, separator?: string): boolean {
  const typed = entered.trim();
  const code = batchKeyCode(key, separator);
  if (!typed) return false;
  if (isValidGtin(typed) && isValidGtin(code)) return normalizeGtin(typed) === normalizeGtin(code);
  return typed === code;
}
