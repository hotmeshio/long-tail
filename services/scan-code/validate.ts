import {
  SCAN_ENCODINGS,
  SCAN_SCHEME_KINDS,
  SCAN_VERBS,
  SCAN_MUTATING_VERBS,
  type ScanChoice,
  type ScanScheme,
  type ScanStep,
} from '../../types';

const VALID_VERBS = new Set<string>(Object.values(SCAN_VERBS));
/** Double-scan selection tokens — short, label-printable, never scheme-shaped. */
const CHOICE_CODE = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * Reject incoherent scheme config at write time. Throws with the exact
 * problem — a bad scheme silently misparsing every scan is far worse
 * than a loud upsert failure.
 */
export function assertValidScheme(scheme: Partial<ScanScheme>): void {
  if (!Number.isInteger(scheme.version) || scheme.version! < 10 || scheme.version! > 99) {
    throw new Error('scheme version must be a two-digit integer between 10 and 99');
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
  const kind = scheme.kind ?? SCAN_SCHEME_KINDS.ACTION;
  if (kind !== SCAN_SCHEME_KINDS.ACTION && kind !== SCAN_SCHEME_KINDS.IDENTITY) {
    throw new Error(`unknown scheme kind "${kind}"`);
  }
  if (kind === SCAN_SCHEME_KINDS.IDENTITY) {
    const ttl = scheme.grant_ttl_seconds;
    if (!Number.isInteger(ttl) || ttl! < 1 || ttl! > 86_400) {
      throw new Error('identity schemes require grant_ttl_seconds between 1 and 86400');
    }
    if (!Number.isInteger(scheme.grant_max_uses ?? 0) || (scheme.grant_max_uses ?? 0) < 0) {
      throw new Error('grant_max_uses must be a non-negative integer');
    }
  } else if (scheme.grant_ttl_seconds != null || (scheme.grant_max_uses ?? 0) !== 0) {
    throw new Error('grant policy applies only to identity schemes');
  }
}

/** Identity rules never walk steps — their fallback is the unknown-badge screen. */
export function assertValidIdentityRule(steps: ScanStep[]): void {
  if (Array.isArray(steps) && steps.length > 0) {
    throw new Error('identity-scheme rules must have no steps (the fallback is the unknown-badge screen)');
  }
}

/** Per-choice validation — a choice is a step verb with a label, minus locate concerns. */
function assertValidChoices(choices: ScanChoice[] | undefined, at: string): void {
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error(`${at}: present requires a non-empty choices array`);
  }
  const codes = new Set<string>();
  choices.forEach((choice, j) => {
    const cat = `${at} choice ${j + 1}`;
    if (!choice || typeof choice !== 'object') throw new Error(`${cat} must be an object`);
    if (!choice.label) throw new Error(`${cat}: label is required`);
    if (!VALID_VERBS.has(choice.verb)) throw new Error(`${cat}: unknown verb "${choice.verb}"`);
    if (choice.verb === SCAN_VERBS.PRESENT || choice.verb === SCAN_VERBS.SHOW_LIST) {
      throw new Error(`${cat}: ${choice.verb} cannot be a choice verb`);
    }
    if (choice.confirm && !choice.confirm.prompt) {
      throw new Error(`${cat}: confirm requires a prompt`);
    }
    if (choice.verb === SCAN_VERBS.ESCALATE && !choice.params?.targetRole) {
      throw new Error(`${cat}: escalate requires params.targetRole`);
    }
    if (choice.verb === SCAN_VERBS.RESOLVE && !choice.params?.resolverPayload) {
      throw new Error(`${cat}: resolve requires params.resolverPayload`);
    }
    if (choice.code !== undefined) {
      if (!CHOICE_CODE.test(choice.code)) {
        throw new Error(`${cat}: code must be 1-32 letters, digits, underscore, or dash`);
      }
      if (codes.has(choice.code)) throw new Error(`${cat}: duplicate code "${choice.code}"`);
      codes.add(choice.code);
    }
  });
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
    // The classic confirm flow completes through per-id endpoints as the
    // logged-in principal — it cannot carry an acting identity. Identity-gated
    // ask-first flows are authored as PRESENT choices with confirm.
    if (step.confirm && step.requireActingIdentity) {
      throw new Error(`${at}: confirm and requireActingIdentity are incompatible — use a present step with a confirming choice`);
    }
    if (step.verb === SCAN_VERBS.PRESENT) {
      if (step.confirm) throw new Error(`${at}: present steps cannot carry confirm (choices confirm individually)`);
      if (step.cardinality === 'many') throw new Error(`${at}: present locates a single row (cardinality first)`);
      assertValidChoices(step.choices, at);
      if (step.autoSelectSingle && step.choices!.length !== 1) {
        throw new Error(`${at}: autoSelectSingle requires exactly one choice`);
      }
      if (step.autoSelectSingle && step.choices![0].confirm) {
        throw new Error(`${at}: autoSelectSingle cannot skip a confirming choice — drop the confirm or the auto-select`);
      }
    } else {
      if (step.choices !== undefined) throw new Error(`${at}: choices apply only to present steps`);
      if (step.autoSelectSingle) throw new Error(`${at}: autoSelectSingle applies only to present steps`);
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
