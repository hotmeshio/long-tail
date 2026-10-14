import { SCAN_FACT_FORMATS, SCAN_VERBS, type ScanStep } from '../../types';

const FACT_FORMATS = new Set<string>(Object.values(SCAN_FACT_FORMATS));
/** A formatted fact reads one value: a single `{bag.key}` token. */
const SINGLE_TOKEN = /^\{[a-z]+\.[^{}]+\}$/;

/** The most facts a station screen states before it reads as a data dump. */
export const SCAN_FACTS_MAX = 12;

/** `facts` on a present step: labeled template values the station states, optionally formatted. */
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
    if (fact.format === undefined) return;
    if (!FACT_FORMATS.has(fact.format)) {
      throw new Error(`${at}: facts[${i}].format must be one of ${[...FACT_FORMATS].join(', ')}`);
    }
    if (!SINGLE_TOKEN.test(fact.value.trim())) {
      throw new Error(`${at}: facts[${i}] with a format must read a single token, e.g. {item.releaseAt}`);
    }
  });
}
