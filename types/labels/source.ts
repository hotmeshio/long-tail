import type { FacetQuery } from '../facets';

/** Where a print job's targets come from. */
export type LabelSource =
  /** Rows the caller selected; re-read under the caller's scope. */
  | { kind: 'escalations'; ids: string[] }
  /** Every row a faceted search returns (searched as the caller); the newest row per target wins. */
  | { kind: 'facets'; query: FacetQuery }
  /** Users carrying the identity scheme's key; the only source for identity schemes. */
  | { kind: 'users'; userIds?: string[]; role?: string }
  /** One target per line; with a header row, columns become {item.<column>} tokens. */
  | { kind: 'list'; text: string }
  /** A numeric run with a prefix, suffix and zero padding. */
  | { kind: 'range'; prefix?: string; from: number; to: number; pad?: number; suffix?: string };

export type LabelSourceKind = LabelSource['kind'];

/** One resolved target: the code's target, and the facts its text tokens read. */
export interface LabelTarget {
  target: string;
  item?: Record<string, unknown>;
  user?: Record<string, unknown>;
  /** The user an identity label names. */
  userId?: string;
  /** Whether the target names something that exists today; undefined when unchecked. */
  resolved?: boolean;
}
