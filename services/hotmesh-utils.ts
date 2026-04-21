import { getPool } from '../lib/db';

// ── HotMesh timestamp helpers ───────────────────────────────────────────────

/**
 * Convert HotMesh's compact timestamp (YYYYMMDDHHmmss.SSS) to ISO 8601.
 */
export function hmshTimestampToISO(ts: string): string {
  if (!ts || ts.length < 14) return ts;
  const y = ts.slice(0, 4);
  const mo = ts.slice(4, 6);
  const d = ts.slice(6, 8);
  const h = ts.slice(8, 10);
  const mi = ts.slice(10, 12);
  const rest = ts.slice(12); // ss.SSS
  return `${y}-${mo}-${d}T${h}:${mi}:${rest}Z`;
}

/**
 * Compute duration in milliseconds between two HotMesh compact timestamps.
 */
export function computeDuration(ac?: string, au?: string): number | null {
  if (!ac || !au) return null;
  const s = new Date(hmshTimestampToISO(ac)).getTime();
  const e = new Date(hmshTimestampToISO(au)).getTime();
  return e >= s ? e - s : null;
}

// ── HotMesh serialization ───────────────────────────────────────────────────

/**
 * Deserialize a HotMesh serialized value.
 * Prefix conventions: /s = JSON, /d = number, /t = true, /f = false, /n = null.
 */
export function fromString(value: string): unknown {
  if (typeof value !== 'string') return undefined;
  const prefix = value.slice(0, 2);
  const rest = value.slice(2);
  switch (prefix) {
    case '/t': return true;
    case '/f': return false;
    case '/d': return Number(rest);
    case '/n': return null;
    case '/s': return JSON.parse(rest);
    default: return value;
  }
}

// ── Schema helpers ──────────────────────────────────────────────────────────

/**
 * Validate and sanitize an app_id for use as a Postgres schema name.
 */
export function sanitizeAppId(appId: string): string {
  if (!/^[a-zA-Z0-9_.-]+$/.test(appId)) {
    throw new Error('Invalid app_id: must contain only alphanumeric characters, underscores, hyphens, and dots');
  }
  return appId;
}

/**
 * Quote a schema name for safe use in SQL queries (Postgres identifier quoting).
 */
export function quoteSchema(schema: string): string {
  return `"${schema.replace(/"/g, '""')}"`;
}

// ── Symbol inflation ────────────────────────────────────────────────────────

/** Schema-qualified symbol lookup — schema is injected as an identifier, not a parameter. */
export const LOAD_SYMBOL_MAP = (schema: string) =>
  `SELECT key, field, value FROM ${schema}.symbols WHERE key LIKE $1`;

/**
 * Load all symbol key mappings from {schema}.symbols for the given appId.
 * Returns a reverse map: abbreviated 3-char key → human-readable path.
 */
export async function loadSymbolMap(schema: string, appId: string): Promise<Record<string, string>> {
  const pool = getPool();
  try {
    const result = await pool.query(
      LOAD_SYMBOL_MAP(schema),
      ['keys:%'],
    );

    const reverseMap: Record<string, string> = {};
    for (const row of result.rows) {
      if (row.field && row.value) {
        reverseMap[row.value] = row.field;
      }
    }
    return reverseMap;
  } catch (err: any) {
    // Schema or symbols table may not exist yet — return empty map
    // so attribute inflation falls back to raw abbreviated keys.
    if (err.code === '42P01') return {}; // undefined_table
    throw err;
  }
}

/**
 * Inflate raw HotMesh job attributes using the symbol map.
 * Converts abbreviated 3-char keys + dimensional indices into
 * human-readable "dimensions/path" entries with deserialized values.
 *
 * Key patterns:
 *   "abc"          → 3-char job-level key (metadata/jc, data/summary, etc.)
 *   "abc,N,M,..."  → activity/transition key with dimensional index
 *   ":"            → status semaphore
 */
export function inflateAttributes(
  attrs: Record<string, string>,
  symbolMap: Record<string, string>,
): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  const symKeyRegex = /^([a-zA-Z]{2,3})(,\d+(?:,\d+)*)?$/;

  for (const [key, rawValue] of Object.entries(attrs)) {
    if (key === ':') {
      flat[':'] = rawValue;
      continue;
    }

    const match = key.match(symKeyRegex);
    if (match) {
      const letters = match[1];
      const dimSuffix = match[2] || '';
      const inflatedPath = symbolMap[letters] || letters;
      const dimensions = dimSuffix ? dimSuffix.slice(1).replace(/,/g, '/') + '/' : '';
      flat[`${dimensions}${inflatedPath}`] = fromString(rawValue);
    } else {
      flat[key] = fromString(rawValue);
    }
  }

  return flat;
}

/**
 * Rebuild a nested object from a flat "dim1/dim2/.../path" → value map.
 */
export function restoreHierarchy(flat: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key in flat) {
    if (flat[key] === undefined) continue;
    const keys = key.split('/');
    let current: Record<string, unknown> = result;
    for (let i = 0; i < keys.length; i++) {
      if (i === keys.length - 1) {
        current[keys[i]] = flat[key];
      } else {
        current[keys[i]] = current[keys[i]] || {};
        current = current[keys[i]] as Record<string, unknown>;
      }
    }
  }
  return result;
}

// ── Activity extraction ─────────────────────────────────────────────────────

export interface ActivityInfo {
  name: string;
  type: string;
  step: string;
  ac: string | null;
  au: string | null;
  traceId: string | null;
  spanId: string | null;
  error: string | null;
  data: Record<string, unknown> | null;
  dimensions: string;
}

/**
 * Walk an inflated HotMesh hierarchy to extract all activities/transitions.
 * Recurses through numeric dimension keys, collecting activity nodes that
 * have an `output.metadata` subtree.
 */
export function extractActivities(hierarchy: Record<string, unknown>): ActivityInfo[] {
  const activities: ActivityInfo[] = [];

  function walk(node: Record<string, unknown>, dims: string[]) {
    for (const key of Object.keys(node)) {
      if (/^\d+$/.test(key)) {
        walk(node[key] as Record<string, unknown>, [...dims, key]);
        continue;
      }

      const actNode = node[key] as Record<string, unknown> | undefined;
      if (!actNode || typeof actNode !== 'object') continue;

      const output = actNode['output'] as Record<string, unknown> | undefined;
      if (!output) continue;

      const meta = output['metadata'] as Record<string, unknown> | undefined;
      const data = output['data'] as Record<string, unknown> | undefined;
      if (!meta) continue;

      activities.push({
        name: key,
        type: (meta['atp'] as string) || 'worker',
        step: (meta['stp'] as string) || key,
        ac: (meta['ac'] as string) || null,
        au: (meta['au'] as string) || null,
        traceId: (meta['l1s'] as string) || null,
        spanId: (meta['l2s'] as string) || null,
        error: (meta['err'] as string) || null,
        data: data || null,
        dimensions: dims.join('/'),
      });
    }
  }

  walk(hierarchy, []);

  activities.sort((a, b) => {
    if (!a.ac) return 1;
    if (!b.ac) return -1;
    return a.ac.localeCompare(b.ac);
  });

  return activities;
}
