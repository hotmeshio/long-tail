import { SCAN_VERBS, type ScanStep } from '../../types';

/** The most facts a station screen states before it reads as a data dump. */
export const SCAN_FACTS_MAX = 12;

/** `facts` on a present step: labeled template values the station states. */
export function assertValidFacts(step: ScanStep, at: string): void {
  if (step.facts === undefined) return;
  if (step.verb !== SCAN_VERBS.PRESENT) throw new Error(`${at}: facts apply only to present steps`);
  if (!Array.isArray(step.facts) || step.facts.length === 0 || step.facts.length > SCAN_FACTS_MAX) {
    throw new Error(`${at}: facts must be an array of 1-${SCAN_FACTS_MAX} { label, value } entries`);
  }
  step.facts.forEach((fact, i) => {
    if (!fact || typeof fact !== 'object' || typeof fact.label !== 'string' || !fact.label.trim()) {
      throw new Error(`${at}: facts[${i}].label must be non-empty text`);
    }
    if (typeof fact.value !== 'string') throw new Error(`${at}: facts[${i}].value must be a template string`);
  });
}
