import { getPool } from '../../lib/db';
import {
  SCAN_ENCODINGS,
  SCAN_SCHEME_KINDS,
  type ScanScheme,
  type ScanRule,
  type ScanStep,
  type ScanRuleFallback,
} from '../../types';
import { UPSERT_SCHEME, DELETE_SCHEME, UPSERT_ACTION, DELETE_ACTION, SEED_SCHEME, SEED_ACTION } from './sql';
import { assertValidIdentityRule, assertValidScheme, assertValidSteps } from './validate';
import { getScanScheme } from './read';

export interface ScanSchemeInput {
  version: number;
  name: string;
  description?: string | null;
  target_facet: string;
  encoding?: ScanScheme['encoding'];
  delimiter?: string;
  target_length?: number | null;
  kind?: ScanScheme['kind'];
  grant_ttl_seconds?: number | null;
  grant_max_uses?: number;
  enabled?: boolean;
}

export interface ScanRuleInput {
  scheme_version: number;
  category: string;
  name: string;
  steps: ScanStep[];
  fallback?: ScanRuleFallback;
  notPrimed?: ScanRuleFallback;
  enabled?: boolean;
}

function schemeParams(input: ScanSchemeInput): unknown[] {
  return [
    input.version,
    input.name,
    input.description ?? null,
    input.target_facet,
    input.encoding ?? SCAN_ENCODINGS.FIXED,
    input.delimiter ?? ':',
    input.target_length ?? null,
    input.kind ?? SCAN_SCHEME_KINDS.ACTION,
    input.grant_ttl_seconds ?? null,
    input.grant_max_uses ?? 0,
    input.enabled ?? true,
  ];
}

function ruleParams(input: ScanRuleInput): unknown[] {
  return [
    input.scheme_version,
    input.category,
    input.name,
    JSON.stringify(input.steps),
    JSON.stringify(input.fallback ?? {}),
    JSON.stringify(input.notPrimed ?? {}),
    input.enabled ?? true,
  ];
}

/** Identity-scheme rules never walk steps; validated against the OWNING scheme's kind. */
async function assertStepsForScheme(input: ScanRuleInput): Promise<void> {
  const scheme = await getScanScheme(input.scheme_version);
  if (scheme?.kind === SCAN_SCHEME_KINDS.IDENTITY) {
    assertValidIdentityRule(input.steps);
    return;
  }
  assertValidSteps(input.steps);
}

export async function upsertScanScheme(input: ScanSchemeInput): Promise<ScanScheme> {
  assertValidScheme(input);
  const { rows } = await getPool().query(UPSERT_SCHEME, schemeParams(input));
  return rows[0];
}

export async function deleteScanScheme(version: number): Promise<boolean> {
  const { rowCount } = await getPool().query(DELETE_SCHEME, [version]);
  return (rowCount ?? 0) > 0;
}

export async function upsertScanRule(input: ScanRuleInput): Promise<ScanRule> {
  if (!/^[0-9]$/.test(input.category)) {
    throw new Error('category must be a single digit (0-9)');
  }
  if (!input.name) throw new Error('rule name is required');
  await assertStepsForScheme(input);
  if (input.steps.length === 0 && !input.fallback?.markdown && !input.fallback?.route) {
    throw new Error('a rule needs at least one step or a fallback');
  }
  const { rows } = await getPool().query(UPSERT_ACTION, ruleParams(input));
  return rows[0];
}

export async function deleteScanRule(
  schemeVersion: number,
  category: string,
): Promise<boolean> {
  const { rowCount } = await getPool().query(DELETE_ACTION, [schemeVersion, category]);
  return (rowCount ?? 0) > 0;
}

/** Insert-if-absent seeding — DB is the source of truth, never overwrite. */
export async function seedScanScheme(input: ScanSchemeInput): Promise<boolean> {
  assertValidScheme(input);
  const { rowCount } = await getPool().query(SEED_SCHEME, schemeParams(input));
  return (rowCount ?? 0) > 0;
}

export async function seedScanRule(input: ScanRuleInput): Promise<boolean> {
  await assertStepsForScheme(input);
  const { rowCount } = await getPool().query(SEED_ACTION, ruleParams(input));
  return (rowCount ?? 0) > 0;
}
