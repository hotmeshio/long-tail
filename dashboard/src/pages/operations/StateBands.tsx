import type { AggregateRow } from '../../api/escalation-analytics';
import { totalDwell } from './entity-pivot';
import { formatDurationCompact } from '../../lib/format';

/** One stacked band of state dwell. */
export function StateBand({
  groups,
  colors,
  height,
  className = '',
}: {
  groups: AggregateRow[];
  colors: Map<string, string>;
  height: string;
  className?: string;
}) {
  const total = totalDwell(groups);
  return (
    <div className={`${height} flex rounded-full overflow-hidden bg-surface-sunken ${className}`}>
      {groups.map((g) => (
        <div
          key={g.state ?? '—'}
          title={`${g.state ?? '—'} · ${formatDurationCompact((g.dwellSeconds ?? 0) * 1000)}`}
          style={{ width: `${((g.dwellSeconds ?? 0) / total) * 100}%`, backgroundColor: colors.get(g.state ?? '—') }}
        />
      ))}
    </div>
  );
}

/** Small-multiple bands, one per slice value, ranked by total dwell. */
export function SliceBands({
  groups,
  sliceKey,
  colors,
  overflow,
}: {
  groups: AggregateRow[];
  sliceKey: string;
  colors: Map<string, string>;
  overflow?: boolean;
}) {
  const byValue = new Map<string, AggregateRow[]>();
  for (const g of groups) {
    if ((g.dwellSeconds ?? 0) <= 0) continue;
    const value = g.facets[sliceKey] ?? 'no value';
    const rows = byValue.get(value) ?? [];
    rows.push(g);
    byValue.set(value, rows);
  }
  const ranked = [...byValue.entries()]
    .map(([value, rows]) => ({ value, rows, total: totalDwell(rows) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  if (ranked.length === 0) {
    return <p className="text-2xs text-text-quaternary">No tracked time for this slice in the window.</p>;
  }
  return (
    <div className="space-y-1.5 max-w-3xl">
      {ranked.map(({ value, rows, total }) => (
        <div key={value} className="flex items-center gap-3 text-2xs">
          <span className="font-mono text-text-secondary truncate w-44 shrink-0" title={value}>{value}</span>
          <StateBand groups={rows} colors={colors} height="h-2" className="flex-1" />
          <span className="font-mono tabular-nums text-text-secondary w-16 text-right shrink-0">
            {formatDurationCompact(total * 1000)}
          </span>
        </div>
      ))}
      {(overflow || byValue.size > 8) && (
        <p className="text-2xs text-text-quaternary pt-1">top 8 values by tracked time</p>
      )}
    </div>
  );
}
