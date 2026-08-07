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
  // Segments render in the GLOBAL color order (the colors map is built in
  // dwell-rank order — blue → orange → green → …), not each band's own
  // dominant-first order. A fixed sequence makes ratios comparable at a glance
  // across the system band, slice headers, and every per-entity row.
  const rank = new Map([...colors.keys()].map((k, i) => [k, i]));
  const ordered = [...groups].sort(
    (a, b) => (rank.get(a.state ?? '—') ?? Infinity) - (rank.get(b.state ?? '—') ?? Infinity),
  );
  return (
    <div className={`${height} flex rounded-full overflow-hidden bg-surface-sunken ${className}`}>
      {ordered.map((g) => (
        <div
          key={g.state ?? '—'}
          title={`${g.state ?? '—'} · ${formatDurationCompact((g.dwellSeconds ?? 0) * 1000)}`}
          style={{ width: `${((g.dwellSeconds ?? 0) / total) * 100}%`, backgroundColor: colors.get(g.state ?? '—') }}
        />
      ))}
    </div>
  );
}
