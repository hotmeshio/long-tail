import { describe, it, expect } from 'vitest';
import {
  assertValidScheme,
  assertValidSteps,
  assertValidIdentityRule,
} from '../../../services/scan-code/validate';
import { SCAN_ENCODINGS, SCAN_SCHEME_KINDS, SCAN_VERBS } from '../../../types';
import type { ScanStep } from '../../../types';

// Write-time coherence for the identity kind and the PRESENT choice set —
// a bad scheme silently misbehaving on the floor is worse than a loud upsert.

const identityScheme = {
  version: 12,
  name: 'Associate badge',
  target_facet: 'badge_id',
  encoding: SCAN_ENCODINGS.DELIMITED,
  delimiter: ':',
  kind: SCAN_SCHEME_KINDS.IDENTITY,
  grant_ttl_seconds: 300,
  grant_max_uses: 0,
};

describe('assertValidScheme — kind + grant policy', () => {
  it('accepts a coherent identity scheme', () => {
    expect(() => assertValidScheme(identityScheme as any)).not.toThrow();
  });

  it('identity requires a bounded grant TTL', () => {
    expect(() => assertValidScheme({ ...identityScheme, grant_ttl_seconds: undefined } as any))
      .toThrow(/grant_ttl_seconds/);
    expect(() => assertValidScheme({ ...identityScheme, grant_ttl_seconds: 0 } as any))
      .toThrow(/grant_ttl_seconds/);
    expect(() => assertValidScheme({ ...identityScheme, grant_ttl_seconds: 100_000 } as any))
      .toThrow(/grant_ttl_seconds/);
  });

  it('rejects grant policy on action schemes and unknown kinds', () => {
    expect(() => assertValidScheme({
      ...identityScheme, kind: SCAN_SCHEME_KINDS.ACTION,
    } as any)).toThrow(/identity schemes/);
    expect(() => assertValidScheme({ ...identityScheme, kind: 'badge' } as any))
      .toThrow(/unknown scheme kind/);
    expect(() => assertValidScheme({ ...identityScheme, grant_max_uses: -1 } as any))
      .toThrow(/grant_max_uses/);
  });
});

describe('assertValidIdentityRule', () => {
  it('identity rules carry no steps — the fallback is the unknown-badge screen', () => {
    expect(() => assertValidIdentityRule([])).not.toThrow();
    expect(() => assertValidIdentityRule([
      { query: {}, verb: SCAN_VERBS.SHOW_DETAIL } as ScanStep,
    ])).toThrow(/no steps/);
  });
});

describe('assertValidSteps — PRESENT + choices', () => {
  const present = (over: Partial<ScanStep> = {}): ScanStep[] => [{
    query: {},
    verb: SCAN_VERBS.PRESENT,
    choices: [
      { label: 'Claim & Start', verb: SCAN_VERBS.CLAIM, requireActingIdentity: true, code: 'CLAIM' },
      { label: 'Report Issue', verb: SCAN_VERBS.ESCALATE, params: { targetRole: 'triage' } },
    ],
    ...over,
  } as ScanStep];

  it('accepts a coherent present step', () => {
    expect(() => assertValidSteps(present())).not.toThrow();
  });

  it('present requires a non-empty choice set and single cardinality', () => {
    expect(() => assertValidSteps(present({ choices: [] }))).toThrow(/non-empty choices/);
    expect(() => assertValidSteps(present({ choices: undefined }))).toThrow(/non-empty choices/);
    expect(() => assertValidSteps(present({ cardinality: 'many' }))).toThrow(/single row/);
    // The generic mutating-verb confirm gate fires first — present is read-only.
    expect(() => assertValidSteps(present({ confirm: { prompt: 'x' } }))).toThrow(/confirm/);
  });

  it('choices carry step-verb coherence: escalate/resolve params, no nesting', () => {
    expect(() => assertValidSteps(present({
      choices: [{ label: 'Bad', verb: SCAN_VERBS.ESCALATE }],
    }))).toThrow(/targetRole/);
    expect(() => assertValidSteps(present({
      choices: [{ label: 'Bad', verb: SCAN_VERBS.RESOLVE }],
    }))).toThrow(/resolverPayload/);
    expect(() => assertValidSteps(present({
      choices: [{ label: 'Bad', verb: SCAN_VERBS.PRESENT }],
    }))).toThrow(/cannot be a choice verb/);
    expect(() => assertValidSteps(present({
      choices: [{ label: '', verb: SCAN_VERBS.CLAIM }],
    }))).toThrow(/label is required/);
  });

  it('choice codes are short label tokens, unique within the step', () => {
    expect(() => assertValidSteps(present({
      choices: [
        { label: 'A', verb: SCAN_VERBS.CLAIM, code: 'GO' },
        { label: 'B', verb: SCAN_VERBS.RELEASE, code: 'GO' },
      ],
    }))).toThrow(/duplicate code/);
    expect(() => assertValidSteps(present({
      choices: [{ label: 'A', verb: SCAN_VERBS.CLAIM, code: 'has space' }],
    }))).toThrow(/code must be/);
  });

  it('choices on non-present steps are rejected', () => {
    expect(() => assertValidSteps([{
      query: {}, verb: SCAN_VERBS.CLAIM,
      choices: [{ label: 'A', verb: SCAN_VERBS.CLAIM }],
    } as ScanStep])).toThrow(/only to present/);
  });

  it('confirm + requireActingIdentity on a classic step is incoherent', () => {
    expect(() => assertValidSteps([{
      query: {}, verb: SCAN_VERBS.CLAIM,
      confirm: { prompt: 'Claim?' }, requireActingIdentity: true,
    } as ScanStep])).toThrow(/incompatible/);
  });
});
