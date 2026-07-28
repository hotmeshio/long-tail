import {
  SCAN_ENCODINGS,
  SCAN_VERBS,
  SCAN_MUTATING_VERBS,
  type ScanScheme,
  type ScanStep,
} from '../../types';

const VALID_VERBS = new Set<string>(Object.values(SCAN_VERBS));

/**
 * Reject incoherent scheme config at write time. Throws with the exact
 * problem — a bad scheme silently misparsing every scan is far worse
 * than a loud upsert failure.
 */
export function assertValidScheme(scheme: Partial<ScanScheme>): void {
  if (!Number.isInteger(scheme.version) || scheme.version! < 1 || scheme.version! > 9) {
    throw new Error('scheme version must be an integer between 1 and 9');
  }
  if (!scheme.name) throw new Error('scheme name is required');
  if (!scheme.target_facet) throw new Error('scheme target_facet is required');
  const encoding = scheme.encoding ?? SCAN_ENCODINGS.FIXED;
  if (encoding === SCAN_ENCODINGS.FIXED) {
    if (!Number.isInteger(scheme.target_length) || scheme.target_length! < 1) {
      throw new Error('fixed encoding requires a positive integer target_length');
    }
  }
  if (encoding === SCAN_ENCODINGS.DELIMITED) {
    const delimiter = scheme.delimiter ?? ':';
    if (delimiter.length !== 1) {
      throw new Error('delimited encoding requires a single-character delimiter');
    }
    if (/[0-9]/.test(delimiter)) {
      throw new Error('delimiter must not be a digit');
    }
  }
}

/**
 * Reject incoherent rule steps at write time: a rule that can never
 * execute its verb must fail the upsert, not the factory-floor scan.
 */
export function assertValidSteps(steps: ScanStep[]): void {
  if (!Array.isArray(steps)) throw new Error('steps must be an array');
  steps.forEach((step, i) => {
    const at = `step ${i + 1}`;
    if (!step || typeof step !== 'object') throw new Error(`${at} must be an object`);
    if (!VALID_VERBS.has(step.verb)) {
      throw new Error(`${at}: unknown verb "${step.verb}"`);
    }
    if (step.confirm && !SCAN_MUTATING_VERBS.includes(step.verb)) {
      throw new Error(`${at}: confirm applies only to mutating verbs`);
    }
    if (step.confirm && !step.confirm.prompt) {
      throw new Error(`${at}: confirm requires a prompt`);
    }
    if (step.verb === SCAN_VERBS.ESCALATE && !step.params?.targetRole) {
      throw new Error(`${at}: escalate requires params.targetRole`);
    }
    if (step.verb === SCAN_VERBS.RESOLVE && !step.params?.resolverPayload) {
      throw new Error(`${at}: resolve requires params.resolverPayload`);
    }
    if (step.query && step.query.roles && !Array.isArray(step.query.roles)) {
      throw new Error(`${at}: query.roles must be an array`);
    }
    // Claim and cancel lock via claim-by-metadata, whose SQL filter is the
    // target facet + roles only — extra facet guards would be silently
    // ignored there, so reject them at write time. (Locate, resolve, and
    // escalate steps carry facet guards inside their own atomic filters.)
    const claimLocked = step.verb === SCAN_VERBS.CLAIM
      || step.verb === SCAN_VERBS.CLAIM_SHOW_DETAIL
      || step.verb === SCAN_VERBS.CANCEL
      || (step.verb === SCAN_VERBS.ESCALATE && step.params?.closeCurrent === 'cancel');
    if (claimLocked && !step.confirm
        && step.query?.facets && Object.keys(step.query.facets).length) {
      throw new Error(`${at}: facet guards are not supported on claim-locked steps (${step.verb})`);
    }
  });
}
