import { Link } from 'react-router-dom';
import { EM_DASH, FormattedValue } from '../../common/display/FormattedValue';
import {
  SPLIT_PATHS,
  isExtremeAggregate,
  relatedCountText,
  type RelatedColumnDecl,
  type RelatedHostAggregate,
  type RelatedSetResult,
} from '../../../lib/list-schema';

/** A split value's display text: the declared label, a role title, or the value. */
export function splitLabel(value: string, col: RelatedColumnDecl, set?: RelatedSetResult): string {
  if (col.labels?.[value]) return col.labels[value];
  if (col.splitBy === SPLIT_PATHS.ROLE && set?.roleLabels?.[value]) return set.roleLabels[value];
  return value === '' ? 'None' : value;
}

/**
 * A related column cell: the count (or its `display` text), then each split
 * value as a chip in declaration order (role order for a role split), largest
 * first otherwise. A min or max column shows its value. Splits the viewer
 * cannot read show as a muted note, never a wrong split.
 */
export function RelatedCell({ col, set, agg, drillUrl }: {
  col: RelatedColumnDecl;
  set?: RelatedSetResult;
  agg?: RelatedHostAggregate;
  /** Query role splits: where a chip leads (the role list with the host's facets). */
  drillUrl?: (role: string) => string | null;
}) {
  if (!agg || agg.unresolved) return <span className="text-text-quaternary">{EM_DASH}</span>;
  if (isExtremeAggregate(col.aggregate)) {
    if (agg.value === undefined) return <span className="text-text-quaternary">{EM_DASH}</span>;
    return (
      <span className="tabular-nums text-text-primary" data-testid="related-cell">
        <FormattedValue raw={String(agg.value)} format={col.format} />
      </span>
    );
  }
  const countText = relatedCountText(col.display, agg.count);
  const order = col.splitBy === SPLIT_PATHS.ROLE && set?.roles ? set.roles : null;
  const splits = Object.entries(agg.splits ?? {})
    .filter(([, n]) => n > 0)
    .sort(([a, x], [b, y]) => (order ? order.indexOf(a) - order.indexOf(b) : y - x));
  const restricted = col.splitBy === SPLIT_PATHS.ROLE ? (set?.restricted ?? []) : [];
  const title = [
    countText !== null ? String(agg.count) : '',
    agg.hidden ? `${agg.hidden} not readable by you` : '',
    restricted.length ? `Not counted (outside your view): ${restricted.map((r) => set?.roleLabels?.[r] ?? r).join(', ')}` : '',
  ].filter(Boolean).join(' · ');

  return (
    <span className="inline-flex flex-wrap items-center gap-1 min-w-0" title={title || undefined} data-testid="related-cell">
      <span className="tabular-nums font-medium text-text-primary" data-testid="related-count">{countText ?? agg.count}</span>
      {splits.map(([value, n]) => {
        const text = `${splitLabel(value, col, set)} ${n}`;
        const href = order && drillUrl ? drillUrl(value) : null;
        const chip = 'px-1.5 py-0.5 rounded bg-surface-sunken text-2xs text-text-secondary whitespace-nowrap tabular-nums';
        return href ? (
          <Link key={value} to={href} onClick={(e) => e.stopPropagation()} className={`${chip} hover:text-accent`} data-testid="related-chip">
            {text}
          </Link>
        ) : (
          <span key={value} className={chip} data-testid="related-chip">{text}</span>
        );
      })}
      {(agg.hidden || restricted.length > 0) && (
        <span className="text-2xs text-text-quaternary italic" data-testid="related-restricted">
          {agg.hidden && !splits.length ? 'split restricted' : 'partial'}
        </span>
      )}
    </span>
  );
}
