import { SCAN_AVAILABILITY, SCAN_VERBS, type ScanStep } from '../../types';

// Verbs whose atomic statement locates by the target facet alone when they
// run as a step; a type/subtype guard on the step would never reach it.
const RELOCATING_VERBS: readonly string[] = [
  SCAN_VERBS.CLAIM, SCAN_VERBS.CLAIM_SHOW_DETAIL, SCAN_VERBS.CANCEL,
  SCAN_VERBS.RELEASE, SCAN_VERBS.ESCALATE, SCAN_VERBS.RESOLVE,
];

/**
 * query.types / query.subtypes narrow a locate that is followed by a write
 * by id. Every present choice writes the row it showed, so a present step
 * takes them with any choice; claim, cancel, release, resolve and escalate
 * steps do not.
 */
export function assertValidQueryKinds(step: ScanStep, at: string): void {
  const { types, subtypes } = step.query ?? {};
  if (types === undefined && subtypes === undefined) return;
  for (const [name, list] of [['types', types], ['subtypes', subtypes]] as const) {
    if (list !== undefined && (!Array.isArray(list) || list.length === 0
      || !list.every((v) => typeof v === 'string' && v))) {
      throw new Error(`${at}: query.${name} must be a non-empty array of strings`);
    }
  }
  if (RELOCATING_VERBS.includes(step.verb)) {
    throw new Error(`${at}: query.types/subtypes are not supported on ${step.verb} steps (the write re-locates by the target facet)`);
  }
  if (step.subject) {
    throw new Error(`${at}: a subject step narrows with params.accumulate.container or item, not query.types/subtypes`);
  }
  if (step.query?.availability === SCAN_AVAILABILITY.MINE && ((types?.length ?? 0) > 1 || (subtypes?.length ?? 0) > 1)) {
    throw new Error(`${at}: with availability 'mine', query.types and query.subtypes take at most one entry each`);
  }
}
