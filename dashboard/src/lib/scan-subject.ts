import {
  SCAN_OUTCOMES,
  type ScanExecuteResponse,
  type ScanHeldSubject,
  type ScanSubjectRef,
} from '../api/scan-codes';

/**
 * The item the station is holding: the subject a HOLD returned, plus how
 * long it lives so a continuing act (a fill with items still to scan) can
 * extend it by the same span.
 */
export interface StationSubject extends ScanHeldSubject {
  ttlMs: number;
}

/** A replayable scan waiting on a badge. */
export interface PendingScan {
  code: string;
  at: number;
}

/** How long a scan waits for the badge before the station lets it go. */
export const PENDING_SCAN_TTL_MS = 30_000;

/** The pointer the next scan carries, when a live subject is held. */
export function subjectRef(subject: StationSubject | null, now = Date.now()): ScanSubjectRef | undefined {
  if (!subject || Date.parse(subject.expiresAt) <= now) return undefined;
  return { code: subject.code, escalationId: subject.escalationId };
}

/**
 * The subject after a response: a HOLD replaces it, a clear drops it, an act
 * that leaves it standing extends it, anything else leaves it as it was.
 */
export function nextSubject(
  current: StationSubject | null,
  response: ScanExecuteResponse,
  now = Date.now(),
): StationSubject | null {
  if (response.outcome === SCAN_OUTCOMES.HELD && response.subject) {
    const ttlMs = Math.max(0, Date.parse(response.subject.expiresAt) - now);
    return { ...response.subject, ttlMs };
  }
  if (response.clearSubject) return null;
  if (!current) return null;
  if (response.outcome === SCAN_OUTCOMES.EXECUTED && response.progress && response.progress.remaining > 0) {
    return { ...current, expiresAt: new Date(now + current.ttlMs).toISOString() };
  }
  return current;
}

/** True when the response is a badge stop the station should replay after priming. */
export function isReplayable(response: ScanExecuteResponse): boolean {
  return response.outcome === SCAN_OUTCOMES.NOT_PRIMED && response.replayable === true;
}

/** The pending scan to replay after a badge primes, if it has not lapsed. */
export function replayable(pending: PendingScan | null, now = Date.now()): PendingScan | null {
  return pending && now - pending.at <= PENDING_SCAN_TTL_MS ? pending : null;
}

/** Outcomes the station screen answers (the bench motion lives there). */
export const STATION_OUTCOMES: readonly string[] = [
  SCAN_OUTCOMES.HELD,
  SCAN_OUTCOMES.REFUSED,
  SCAN_OUTCOMES.SUBJECT_STALE,
];
