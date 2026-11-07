import { SCAN_MUTATING_VERBS, SCAN_VERBS, type ScanDoneCopy, type ScanStep, type ScanVerb } from '../../types';
import { FACET_KEY } from '../escalation/facet-sql';

/** A form field name, as `hold.show` and a present step's `show` name one. */
export const ROSTER_FIELD = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** The longest a done screen waits before the station returns. */
export const SCAN_DONE_AFTER_SECONDS_MAX = 60;

const OPEN_TARGETS = new Set(['row', 'subject', 'located']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** A done copy: markdown, an optional pause before the station returns, and the line under it. */
export function assertValidDoneCopy(done: ScanDoneCopy | undefined, at: string, field = 'done'): void {
  if (!isPlainObject(done) || typeof done.markdown !== 'string' || !done.markdown) {
    throw new Error(`${at}: ${field}.markdown is required`);
  }
  const after = done.afterSeconds;
  if (after !== undefined && (typeof after !== 'number' || !Number.isInteger(after)
    || after < 0 || after > SCAN_DONE_AFTER_SECONDS_MAX)) {
    throw new Error(`${at}: ${field}.afterSeconds must be an integer from 0 to ${SCAN_DONE_AFTER_SECONDS_MAX}`);
  }
  if (done.nextPrompt !== undefined && (typeof done.nextPrompt !== 'string' || !done.nextPrompt.trim())) {
    throw new Error(`${at}: ${field}.nextPrompt must be non-empty markdown`);
  }
}

/** `done` on a step or a choice that writes. */
export function assertValidDone(done: ScanDoneCopy | undefined, verb: ScanVerb, at: string, kind: 'steps' | 'choices' = 'steps'): void {
  if (done === undefined) return;
  assertValidDoneCopy(done, at);
  if (!SCAN_MUTATING_VERBS.includes(verb)) throw new Error(`${at}: done applies only to ${kind} that write`);
}

/** `open`: the Open button on the hold, done or refusal screen a step answers with. */
export function assertValidOpen(step: ScanStep, at: string): void {
  const open = step.open;
  if (open === undefined) return;
  if (!isPlainObject(open)) throw new Error(`${at}: open must be an object`);
  if (!OPEN_TARGETS.has(open.target as string)) {
    throw new Error(`${at}: open.target must be 'row', 'subject' or 'located'`);
  }
  if (open.target === 'subject' && !step.subject && step.verb !== SCAN_VERBS.HOLD) {
    throw new Error(`${at}: open.target 'subject' needs a held subject (a hold step, or a step with a subject gate)`);
  }
  if (open.label !== undefined && (typeof open.label !== 'string' || !open.label.trim())) {
    throw new Error(`${at}: open.label must be non-empty text`);
  }
  if (open.claim !== undefined && typeof open.claim !== 'boolean') {
    throw new Error(`${at}: open.claim must be a boolean`);
  }
  if (open.list !== undefined) {
    const list = open.list;
    if (!isPlainObject(list) || !Array.isArray(list.facets) || list.facets.length === 0
      || !list.facets.every((f) => typeof f === 'string' && FACET_KEY.test(f))) {
      throw new Error(`${at}: open.list.facets must be a non-empty array of facet keys`);
    }
    if (list.role !== undefined && (typeof list.role !== 'string' || !list.role)) {
      throw new Error(`${at}: open.list.role must be a role name`);
    }
    if (open.claim) throw new Error(`${at}: open.claim applies to a row, not a list`);
  }
}

/** `show` on a present step: the roster field rendered above the choices. */
export function assertValidPresentShow(step: ScanStep, at: string): void {
  if (step.show === undefined) return;
  if (step.verb !== SCAN_VERBS.PRESENT) throw new Error(`${at}: show applies only to present steps (a hold uses params.hold.show)`);
  if (typeof step.show !== 'string' || !ROSTER_FIELD.test(step.show)) {
    throw new Error(`${at}: show must name a roster field of the row's form`);
  }
}
