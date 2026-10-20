import {
  RELATED_AGGREGATES,
  RELATED_DISPLAY_DEFAULT,
  RELATED_SOURCES,
  SPLIT_PATHS,
  type RelatedAggregate,
  type RelatedColumnDecl,
} from './types';

const VALUE_TOKEN = /^\{\{\s*([^{}]+?)\s*\}\}$/;
const ITEM_PREFIX = 'item.';
const PATH_SEGMENT = /^[a-zA-Z0-9_]+$/;
const METADATA_KEY = /^[a-zA-Z0-9_]+$/;
const COUNT_TOKEN = /\{n\}/g;

export type RelatedExtreme = typeof RELATED_AGGREGATES.MIN | typeof RELATED_AGGREGATES.MAX;

/** True for the aggregates that pick one value rather than count. */
export function isExtremeAggregate(aggregate: unknown): aggregate is RelatedExtreme {
  return aggregate === RELATED_AGGREGATES.MIN || aggregate === RELATED_AGGREGATES.MAX;
}

/**
 * The stored path a min/max `value` template reads: `payload.<path>` for an
 * items set, `metadata.<key>` for a query set. Null when the template does
 * not fit the set's source.
 */
export function relatedValuePath(source: string, value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const token = value.match(VALUE_TOKEN)?.[1];
  if (!token) return null;
  if (source === RELATED_SOURCES.ITEMS) {
    if (!token.startsWith(`${ITEM_PREFIX}${SPLIT_PATHS.PAYLOAD}`)) return null;
    const path = token.slice(ITEM_PREFIX.length + SPLIT_PATHS.PAYLOAD.length);
    return path && path.split('.').every((s) => PATH_SEGMENT.test(s)) ? `${SPLIT_PATHS.PAYLOAD}${path}` : null;
  }
  if (!token.startsWith(SPLIT_PATHS.METADATA)) return null;
  const key = token.slice(SPLIT_PATHS.METADATA.length);
  return METADATA_KEY.test(key) ? token : null;
}

/** The key a column's per-host aggregates are stored under in its set's result. */
export function relatedAggregateKey(col: Pick<RelatedColumnDecl, 'aggregate' | 'splitBy' | 'value'>, source: string): string {
  if (isExtremeAggregate(col.aggregate)) return `${col.aggregate}:${relatedValuePath(source, col.value) ?? ''}`;
  return col.splitBy ?? '';
}

/** A count column's display text, or null when the column declares none for this count. */
export function relatedCountText(display: Record<string, string> | undefined, count: number): string | null {
  if (!display) return null;
  const text = display[String(count)] ?? display[RELATED_DISPLAY_DEFAULT];
  return text === undefined ? null : text.replace(COUNT_TOKEN, String(count));
}

/**
 * The least or greatest of several values: numbers when every value is a
 * number, otherwise text in code-unit order (ISO instants order as text).
 */
export function foldExtreme(fold: RelatedAggregate, values: Array<string | number>): string | number | undefined {
  if (!values.length) return undefined;
  const pickMin = fold === RELATED_AGGREGATES.MIN;
  if (values.every((v) => typeof v === 'number')) {
    return pickMin ? Math.min(...(values as number[])) : Math.max(...(values as number[]));
  }
  const texts = values.map(String).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return pickMin ? texts[0] : texts[texts.length - 1];
}
