import { getPool } from '../../lib/db';
import {
  SCAN_ENCODINGS,
  type ScanScheme,
  type ScanRule,
  type ScanStep,
  type ScanRuleFallback,
} from '../../types';
import { UPSERT_SCHEME, DELETE_SCHEME, UPSERT_ACTION, DELETE_ACTION, SEED_SCHEME, SEED_ACTION } from './sql';
import { assertValidScheme, assertValidSteps } from './validate';

export interface ScanSchemeInput {
  version: number;
  name: string;
  description?: string | null;
  target_facet: string;
  encoding?: ScanScheme['encoding'];
  delimiter?: string;
  target_length?: number | null;
  enabled?: boolean;
}

export interface ScanRuleInput {
  scheme_version: number;
  category: string;
  name: string;
  steps: ScanStep[];
  fallback?: ScanRuleFallback;
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
    input.enabled ?? true,
  ];
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
  if (!/^[0-9]{2}$/.test(input.category)) {
    throw new Error('category must be exactly two digits (00-99)');
  }
  if (!input.name) throw new Error('rule name is required');
  assertValidSteps(input.steps);
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
  assertValidSteps(input.steps);
  const { rowCount } = await getPool().query(SEED_ACTION, ruleParams(input));
  return (rowCount ?? 0) > 0;
}
