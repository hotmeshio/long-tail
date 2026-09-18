import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { PortalCount } from '../../api/roles';
import { useEscalationListQuery } from '../../hooks/useEscalationListQuery';
import { parseEscalationListUrl, type EscalationListParams } from '../../lib/escalation-list-url';
import { formatCountCompact } from '../../lib/format';

const NO_LIST: EscalationListParams = { statusFilter: '', facets: {}, view: null, layout: null };
const TILE_STALE_MS = 15_000;

/**
 * One count tile: the live total of a list URL, the same number a pin badge
 * carries (limit 1, read total), under a label and over a blurb. The tile
 * links to the list it counts.
 */
export function PortalCountTile({ count, url }: { count: PortalCount; url: string }) {
  const params = useMemo(() => parseEscalationListUrl(url), [url]);
  const list = useEscalationListQuery(params ?? NO_LIST, { limit: 1, offset: 0, staleTime: TILE_STALE_MS, enabled: params !== null });
  const value = !params ? null : list.isLoading && list.total === 0 ? null : list.total;
  return (
    <Link
      to={url}
      className="block min-w-0 border border-surface-border bg-surface-sunken rounded-[var(--lt-radius-section)] px-4 py-3 hover:bg-surface-hover transition-colors"
      title={`Open ${count.label}`}
      data-testid="portal-count"
    >
      <p className="text-2xs uppercase tracking-widest text-text-tertiary truncate">{count.label}</p>
      <p className="mt-1 text-3xl font-light leading-none text-text-primary" data-testid="portal-count-value">
        {value === null ? <span className="text-text-quaternary">—</span> : formatCountCompact(value)}
      </p>
      {count.blurb && <p className="mt-1.5 text-xs text-text-secondary leading-snug">{count.blurb}</p>}
    </Link>
  );
}

/** The row of count tiles above a portal's panels; every tile shares one grid so numbers align. */
export function PortalCounts({ counts, resolveUrl }: { counts: PortalCount[]; resolveUrl: (url: string) => string }) {
  if (counts.length === 0) return null;
  return (
    <div
      className="grid gap-4 shrink-0 mb-4"
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(10rem, 1fr))` }}
      data-testid="portal-counts"
    >
      {counts.map((count, i) => <PortalCountTile key={`${count.label}-${i}`} count={count} url={resolveUrl(count.url)} />)}
    </div>
  );
}
