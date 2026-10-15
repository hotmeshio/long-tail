import {
  FACET_TABLE_LAYOUT,
  GROUP_FOLDS,
  LIST_SCHEMA_KEYS,
  RELATED_AGGREGATES,
  RELATED_LIMITS,
  RELATED_SOURCES,
  SPLIT_PATHS,
  type ListSchemaRelations,
  type RelatedColumnDecl,
  type RelatedSetDecl,
  type RowDetailSectionDecl,
} from './types';

/** A metadata key: interpolated as a JSON path, so strictly validated. */
export const METADATA_KEY = /^[a-zA-Z0-9_]+$/;
const SET_NAME = /^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/;
const PATH_SEGMENT = /^[a-zA-Z0-9_]+$/;

type Obj = Record<string, unknown>;

class ListSchemaError extends Error {}

function fail(message: string): never {
  throw new ListSchemaError(message);
}

function isObj(value: unknown): value is Obj {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** True when a dotted path has only plain segments. */
function isPlainPath(path: string): boolean {
  return path.length > 0 && path.split('.').every((s) => PATH_SEGMENT.test(s));
}

/** The split paths a set's source accepts. */
export function splitPathError(source: string, splitBy: string): string | null {
  if (source === RELATED_SOURCES.QUERY) {
    if (splitBy === SPLIT_PATHS.ROLE) return null;
    if (splitBy.startsWith(SPLIT_PATHS.METADATA) && METADATA_KEY.test(splitBy.slice(SPLIT_PATHS.METADATA.length))) return null;
    return `splitBy "${splitBy}" on a query set must be "role" or "metadata.<key>"`;
  }
  if (splitBy.startsWith(SPLIT_PATHS.PAYLOAD) && isPlainPath(splitBy.slice(SPLIT_PATHS.PAYLOAD.length))) return null;
  if (splitBy.startsWith(SPLIT_PATHS.RECIPROCAL_METADATA)
    && METADATA_KEY.test(splitBy.slice(SPLIT_PATHS.RECIPROCAL_METADATA.length))) return null;
  return `splitBy "${splitBy}" on an items set must be "payload.<path>" or "reciprocal.metadata.<key>"`;
}

function readSet(name: string, raw: unknown): RelatedSetDecl {
  if (!SET_NAME.test(name)) fail(`x-lt-related name "${name}" must start with a letter (letters, digits, _ or -)`);
  if (!isObj(raw)) fail(`x-lt-related.${name} must be an object`);
  if (raw.source === RELATED_SOURCES.ITEMS) {
    if (raw.query !== undefined) fail(`x-lt-related.${name}: an items set takes no query`);
    return { source: RELATED_SOURCES.ITEMS };
  }
  if (raw.source !== RELATED_SOURCES.QUERY) fail(`x-lt-related.${name}.source must be "items" or "query"`);
  const q = raw.query;
  if (!isObj(q)) fail(`x-lt-related.${name}.query is required for a query set`);
  const hasRoles = q.roles !== undefined;
  const hasSegment = q.segment !== undefined;
  if (hasRoles === hasSegment) fail(`x-lt-related.${name}.query takes exactly one of roles or segment`);
  if (hasRoles) {
    const roles = q.roles;
    if (!Array.isArray(roles) || roles.length === 0 || roles.length > RELATED_LIMITS.MAX_QUERY_ROLES
      || !roles.every(isNonEmptyString)) {
      fail(`x-lt-related.${name}.query.roles must be 1..${RELATED_LIMITS.MAX_QUERY_ROLES} role names`);
    }
  } else if (!isNonEmptyString(q.segment)) {
    fail(`x-lt-related.${name}.query.segment must be a role name`);
  }
  if (!isObj(q.facets) || Object.keys(q.facets).length === 0) {
    fail(`x-lt-related.${name}.query.facets must name at least one facet`);
  }
  for (const [key, value] of Object.entries(q.facets)) {
    if (!METADATA_KEY.test(key)) fail(`x-lt-related.${name}.query.facets key "${key}" must be letters, digits or _`);
    if (value === null || typeof value === 'object') fail(`x-lt-related.${name}.query.facets.${key} must be a scalar or template`);
  }
  if (q.narrow !== undefined) {
    if (!isObj(q.narrow) || Object.keys(q.narrow).length === 0) fail(`x-lt-related.${name}.query.narrow must name at least one facet`);
    for (const [key, value] of Object.entries(q.narrow)) {
      if (!METADATA_KEY.test(key)) fail(`x-lt-related.${name}.query.narrow key "${key}" must be letters, digits or _`);
      if (key in q.facets) fail(`x-lt-related.${name}.query.narrow.${key} is already a required facet`);
      if (value === null || typeof value === 'object') fail(`x-lt-related.${name}.query.narrow.${key} must be a scalar or template`);
    }
  }
  if (q.status !== undefined && !isNonEmptyString(q.status)) fail(`x-lt-related.${name}.query.status must be a status`);
  return {
    source: RELATED_SOURCES.QUERY,
    query: {
      ...(hasRoles ? { roles: [...(q.roles as string[])] } : { segment: q.segment as string }),
      facets: { ...q.facets },
      ...(q.narrow !== undefined ? { narrow: { ...(q.narrow as Obj) } } : {}),
      ...(q.status !== undefined ? { status: q.status as string } : {}),
    },
  };
}

function readRelatedColumn(raw: Obj, sets: Record<string, RelatedSetDecl>, at: string): RelatedColumnDecl {
  const name = raw.related;
  if (!isNonEmptyString(name) || !sets[name]) fail(`${at}.related must name a set declared in x-lt-related`);
  if (raw.aggregate !== undefined && raw.aggregate !== RELATED_AGGREGATES.COUNT) fail(`${at}.aggregate must be "count"`);
  if (raw.splitBy !== undefined) {
    if (!isNonEmptyString(raw.splitBy)) fail(`${at}.splitBy must be a path`);
    const err = splitPathError(sets[name].source, raw.splitBy);
    if (err) fail(`${at}: ${err}`);
  }
  if (raw.labels !== undefined && (!isObj(raw.labels) || !Object.values(raw.labels).every((v) => typeof v === 'string'))) {
    fail(`${at}.labels must map values to display text`);
  }
  return raw as unknown as RelatedColumnDecl;
}

function readRowDetail(raw: unknown, sets: Record<string, RelatedSetDecl>): RowDetailSectionDecl[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > RELATED_LIMITS.MAX_ROW_DETAIL_SECTIONS) {
    fail(`x-lt-row-detail must be 1..${RELATED_LIMITS.MAX_ROW_DETAIL_SECTIONS} sections`);
  }
  return raw.map((section, i) => {
    const at = `x-lt-row-detail[${i}]`;
    if (!isObj(section)) fail(`${at} must be an object`);
    if (!isNonEmptyString(section.related) || !sets[section.related]) fail(`${at}.related must name a set declared in x-lt-related`);
    if (!Array.isArray(section.columns) || section.columns.length === 0) fail(`${at}.columns must list at least one column`);
    for (const [j, col] of section.columns.entries()) {
      if (!isObj(col) || !isNonEmptyString(col.label) || typeof col.value !== 'string') {
        fail(`${at}.columns[${j}] needs a label and a value template`);
      }
    }
    if (section.limit !== undefined && (!Number.isInteger(section.limit) || (section.limit as number) < 1
      || (section.limit as number) > RELATED_LIMITS.ROWS_MAX)) {
      fail(`${at}.limit must be 1..${RELATED_LIMITS.ROWS_MAX}`);
    }
    return section as unknown as RowDetailSectionDecl;
  });
}

function readGroupKey(schema: Obj): string | null {
  const raw = schema[LIST_SCHEMA_KEYS.GROUP_BY];
  if (raw === undefined || schema[LIST_SCHEMA_KEYS.LAYOUT] !== FACET_TABLE_LAYOUT) return null;
  const key = typeof raw === 'string' && raw.startsWith(SPLIT_PATHS.METADATA) ? raw.slice(SPLIT_PATHS.METADATA.length) : '';
  if (!METADATA_KEY.test(key)) fail('x-lt-group-by on a facet-table must be "metadata.<key>"');
  return key;
}

const FOLDS = new Set<string>(Object.values(GROUP_FOLDS));

/**
 * Validate and normalize the related declaration of a list schema. Throws on
 * an invalid declaration; keys outside this vocabulary stay opaque.
 */
export function readListSchemaRelations(schema: unknown): ListSchemaRelations {
  const empty: ListSchemaRelations = { sets: {}, columns: [], rowDetail: [], groupKey: null };
  if (!isObj(schema)) return empty;
  const rawSets = schema[LIST_SCHEMA_KEYS.RELATED];
  const sets: Record<string, RelatedSetDecl> = {};
  if (rawSets !== undefined) {
    if (!isObj(rawSets)) fail('x-lt-related must map set names to declarations');
    const names = Object.keys(rawSets);
    if (names.length === 0 || names.length > RELATED_LIMITS.MAX_SETS) fail(`x-lt-related must declare 1..${RELATED_LIMITS.MAX_SETS} sets`);
    for (const name of names) sets[name] = readSet(name, rawSets[name]);
  }
  const columns: RelatedColumnDecl[] = [];
  const rawColumns = schema[LIST_SCHEMA_KEYS.COLUMNS];
  if (Array.isArray(rawColumns)) {
    rawColumns.forEach((col, i) => {
      if (!isObj(col)) return;
      if (col.related !== undefined) columns.push(readRelatedColumn(col, sets, `x-lt-columns[${i}]`));
      if (col.group !== undefined && (typeof col.group !== 'string' || !FOLDS.has(col.group))) {
        fail(`x-lt-columns[${i}].group must be one of ${[...FOLDS].join(', ')}`);
      }
    });
  }
  return { sets, columns, rowDetail: readRowDetail(schema[LIST_SCHEMA_KEYS.ROW_DETAIL], sets), groupKey: readGroupKey(schema) };
}

/** The declaration's first error, or null when valid. */
export function listSchemaRelationsError(schema: unknown): string | null {
  try {
    readListSchemaRelations(schema);
    return null;
  } catch (err) {
    if (err instanceof ListSchemaError) return err.message;
    throw err;
  }
}
