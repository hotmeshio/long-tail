/**
 * Alarms to gateway actions. An alarm that stops work, or one the machine
 * flags for a person, becomes an alarm row on the line's operator role; its
 * clear resolves the row. Each row is keyed (alarmSignalKey), so a raise
 * replayed after a takeover returns the row it raised before, open or ended.
 */

import { DECISION, LINE_ROLE, ROW_TYPE, alarmSignalKey } from '../contracts';
import { ALARM_IDS, LEVEL, STOPPING_LEVELS, type Envelope, type ParsedTopic } from '../../../lib/machines/protocol';
import { DISPOSITION } from '../../../lib/machines/transport';
import { ESCALATION_ENVELOPE_KEYS, type EscalationLookupRef } from '../../../types/escalation';
import { CONTROLLER, type Action, type Plan } from './actions';
import { notePause, noteResume } from './lifecycle';
import type { AlarmTrack, GatewayState } from './state';

const ack = (actions: Action[] = []): Plan => ({ actions, disposition: DISPOSITION.ACK });

/** Whether a raise is the one already tracked: always for an occurrence id, else when neither or both times agree. */
function sameRaise(state: GatewayState, known: AlarmTrack, raisedAt: unknown): boolean {
  if (state.alarmIds === ALARM_IDS.OCCURRENCE) return true;
  return !known.raisedAt || !raisedAt || known.raisedAt === raisedAt;
}

export function planAlarm(state: GatewayState, parsed: ParsedTopic, alarmId: string, env: Envelope | null): Plan {
  const { siteId, lineId, machineId: m } = parsed.ident;
  const key = state.alarmKey(m, alarmId);
  const b: Record<string, any> = env?.body ?? {};
  if (!env || b.active === false) {
    const track = state.alarms.get(key);
    state.alarms.delete(key);
    const resumed = track ? noteResume(state, track, b) : [];
    if (!track?.rowId || !track.open) return ack(resumed);
    return ack([...resumed, {
      kind: 'resolve', as: CONTROLLER, rowId: track.rowId,
      payload: { decision: DECISION.CLEARED, clearedBy: b.clearedBy ?? null, note: `cleared at ${m}${b.clearedBy ? ` by ${b.clearedBy}` : ''}` },
    }]);
  }
  // A stopping level needs a person; so does any alarm the machine flags, at the level it said.
  const stopping = STOPPING_LEVELS.includes(b.level);
  if (!stopping && b.needsPerson !== true) return ack();
  const known = state.alarms.get(key);
  if (known && sameRaise(state, known, b.raisedAt)) return ack();
  const superseded: Action[] = known?.rowId && known.open
    ? [{ kind: 'resolve', as: CONTROLLER, rowId: known.rowId, payload: { decision: DECISION.CLEARED, note: `${m} raised ${alarmId} again; this one ended` } }]
    : [];
  const track: AlarmTrack = { machineId: m, alarmId, raisedAt: b.raisedAt, level: b.level, open: true };
  state.alarms.set(key, track);
  // A recurring id without a raise time cannot tell raises apart, so its row is not keyed.
  const raisedAt = typeof b.raisedAt === 'string' && b.raisedAt ? b.raisedAt : undefined;
  const occurrence = state.alarmIds === ALARM_IDS.OCCURRENCE;
  const keyed = occurrence || raisedAt ? { signal_key: alarmSignalKey(siteId, lineId, m, alarmId, occurrence ? undefined : raisedAt) } : {};
  return ack([...superseded, {
    kind: 'createAlarmRow', machineId: m, alarmId, paused: stopping ? notePause(state, track, b) : [],
    row: {
      type: ROW_TYPE.ALARM, subtype: b.level, role: LINE_ROLE.OPERATOR, priority: b.level === LEVEL.EMERGENCY ? 1 : 2,
      description: `${m}: ${b.text}`,
      metadata: {
        siteId, lineId, machineId: m, alarmId, code: b.code, level: b.level, raisedAt: b.raisedAt,
        zone: b.zone ?? null, autoClears: b.autoClears ?? false, action: b.action ?? null, jobId: b.jobId ?? null,
      },
      ...keyed,
      ...catalogEnvelope(b.catalog),
    },
  }]);
}

/** An alarm naming the catalog edition its code comes from carries that edition as a lookup, so the row reads its meaning. */
function catalogEnvelope(catalog: unknown): { envelope?: string } {
  const ref = catalog as EscalationLookupRef | undefined;
  if (!ref || typeof ref.domain !== 'string' || typeof ref.key !== 'string') return {};
  return { envelope: JSON.stringify({ [ESCALATION_ENVELOPE_KEYS.LOOKUPS]: [ref] }) };
}

/** Alarm rows for `m` whose alarm its snapshot no longer lists: they cleared at the machine. */
export function alarmsNoLongerListed(state: GatewayState, m: string, listed: unknown[]): Action[] {
  const active = new Set(listed.filter((id): id is string => typeof id === 'string'));
  const actions: Action[] = [];
  for (const [key, track] of [...state.alarms.entries()]) {
    if (track.machineId !== m || active.has(track.alarmId)) continue;
    state.alarms.delete(key);
    actions.push(...noteResume(state, track, {}));
    if (track.open && track.rowId) {
      actions.push({ kind: 'resolve', as: CONTROLLER, rowId: track.rowId, payload: { decision: DECISION.CLEARED, note: `cleared at ${m}; its snapshot no longer lists it` } });
    }
  }
  return actions;
}
