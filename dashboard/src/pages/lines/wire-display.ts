import type { MachineView, WireAction, WireVerb } from '../../api/machines';
import { getDisplayTimeZone } from '../../lib/display-zone';

/** Past-tense wording for each action the gateway took on a message. */
export const WIRE_VERB_LABEL: Record<WireVerb, string> = {
  claim: 'claimed',
  accumulate: 'accumulated',
  resolve: 'resolved',
  'create-row': 'row created',
  refuse: 'refused',
  hold: 'held',
  unmatched: 'unmatched',
  unreadable: 'unreadable',
  ack: 'acknowledged',
  none: '',
};

/** Text-safe status tone per verb. */
export const WIRE_VERB_TONE: Record<WireVerb, string> = {
  claim: 'text-text-secondary',
  accumulate: 'text-text-secondary',
  resolve: 'text-status-success',
  'create-row': 'text-text-secondary',
  refuse: 'text-status-error',
  hold: 'text-status-warning',
  unmatched: 'text-status-warning',
  unreadable: 'text-status-error',
  ack: 'text-text-secondary',
  none: 'text-text-quaternary',
};

/** "accumulated arrived:U1": the verb plus the item it touched. */
export function describeAction(action: WireAction): string {
  const label = WIRE_VERB_LABEL[action.verb] ?? action.verb;
  return action.itemKey ? `${label} ${action.itemKey}` : label;
}

/** Actions worth a word; `none` stays silent. */
export function visibleActions(actions: WireAction[]): WireAction[] {
  return actions.filter((a) => a.verb !== 'none');
}

/** The escalation detail route for a row the gateway named. */
export function rowPath(rowId: string): string {
  return `/escalations/detail/${encodeURIComponent(rowId)}`;
}

/** "13:02:07" in the display zone, for the tape's time column. */
export function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const zone = getDisplayTimeZone();
  return new Intl.DateTimeFormat('en-GB', {
    ...(zone ? { timeZone: zone } : {}),
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

export type Presence = 'online' | 'quiet' | 'offline' | 'unknown';

/** Ring color per presence, through the graphic status tokens. */
export const PRESENCE_DOT: Record<Presence, string> = {
  online: 'bg-status-success-graphic',
  quiet: 'bg-status-pending-graphic',
  offline: 'bg-status-error',
  unknown: 'bg-text-quaternary',
};

export const PRESENCE_LABEL: Record<Presence, string> = {
  online: 'online',
  quiet: 'quiet',
  offline: 'offline',
  unknown: 'unknown',
};

/** Quiet is online with an open quiet row; unknown is a machine the leader has yet to hear. */
export function presenceOf(view: MachineView | undefined): Presence {
  if (!view || view.online === null) return 'unknown';
  if (!view.online) return 'offline';
  return view.rows.quietRowId ? 'quiet' : 'online';
}

/** Pretty JSON for panels; strings stay as they are. */
export function formatJson(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
