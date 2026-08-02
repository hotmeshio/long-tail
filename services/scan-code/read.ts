import { getPool } from '../../lib/db';
import type { ScanScheme, ScanRule } from '../../types';
import { LIST_SCHEMES, GET_SCHEME, LIST_ACTIONS, GET_ACTION } from './sql';

function mapScheme(row: any): ScanScheme {
  return {
    version: row.version,
    name: row.name,
    description: row.description ?? null,
    target_facet: row.target_facet,
    encoding: row.encoding,
    delimiter: row.delimiter,
    target_length: row.target_length ?? null,
    kind: row.kind ?? 'action',
    grant_ttl_seconds: row.grant_ttl_seconds ?? null,
    grant_max_uses: row.grant_max_uses ?? 0,
    enabled: row.enabled,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapRule(row: any): ScanRule {
  return {
    scheme_version: row.scheme_version,
    category: row.category,
    name: row.name,
    steps: row.steps ?? [],
    fallback: row.fallback ?? {},
    notPrimed: row.not_primed ?? {},
    enabled: row.enabled,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listScanSchemes(): Promise<ScanScheme[]> {
  const { rows } = await getPool().query(LIST_SCHEMES);
  return rows.map(mapScheme);
}

export async function getScanScheme(version: number): Promise<ScanScheme | null> {
  const { rows } = await getPool().query(GET_SCHEME, [version]);
  return rows.length ? mapScheme(rows[0]) : null;
}

export async function listScanRules(schemeVersion: number): Promise<ScanRule[]> {
  const { rows } = await getPool().query(LIST_ACTIONS, [schemeVersion]);
  return rows.map(mapRule);
}

export async function getScanRule(
  schemeVersion: number,
  category: string,
): Promise<ScanRule | null> {
  const { rows } = await getPool().query(GET_ACTION, [schemeVersion, category]);
  return rows.length ? mapRule(rows[0]) : null;
}
