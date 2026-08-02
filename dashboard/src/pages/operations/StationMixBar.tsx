import { useMemo } from 'react';
import type { AggregateRow } from '../../api/escalation-analytics';
import { subtypeKey, subtypeLabel } from './mix-colors';
import { formatDurationCompact } from '../../lib/format';

/**
 * Time-in-state mix for one station over the board's window — the mini-bar
 * sibling of the Load bar: each segment is a subtype's share of the station's
 * tracked time. The number beside it is the dominant share; the tooltip
 * carries the full breakdown. `—` when there is no data (empty window, or the
 * analytics gate withheld it).
 */
export function StationMixBar({
  groups,
  colors,
}: {
  groups: AggregateRow[] | undefined;
  colors: Map<string, string>;
}) {
  const segments = useMemo(() => {
    const rows = (groups ?? []).filter((g) => (g.dwellSeconds ?? 0) > 0);
    const total = rows.reduce((sum, g) => sum + (g.dwellSeconds ?? 0), 0);
    if (!total) return null;
    return rows
      .map((g) => ({
        key: subtypeKey(g.subtype),
        label: subtypeLabel(g.subtype),
        seconds: g.dwellSeconds ?? 0,
        pct: (g.dwellSeconds ?? 0) / total,
      }))
      .sort((a, b) => b.seconds - a.seconds);
  }, [groups]);

  if (!segments) {
    return <span className="text-2xs text-text-quaternary">—</span>;
  }

  const tooltip = segments
    .map((s) => `${s.label} ${formatDurationCompact(s.seconds * 1000)} · ${Math.round(s.pct * 100)}%`)
    .join('\n');

  return (
    <div className="flex items-center gap-1.5" title={tooltip}>
      <div className="w-16 h-1.5 bg-surface-sunken rounded-full overflow-hidden flex shrink-0">
        {segments.map((s) => (
          <div
            key={s.key}
            style={{ width: `${s.pct * 100}%`, backgroundColor: colors.get(s.key) }}
          />
        ))}
      </div>
      <span className="text-2xs font-mono text-text-quaternary tabular-nums">
        {Math.round(segments[0].pct * 100)}%
      </span>
    </div>
  );
}
