import { useState } from 'react';
import type { StationMetric } from '../../api/escalations';
import { displayRoleTitle } from '../../lib/role-display';

export interface ChartStation {
  role: string;
  title: string | null;
  target_per_hour: number | null;
  parent_role: string | null;
  /** Roles feeding this station from other sequences — drawn as a merge glyph, not a bend in the line. */
  upstream_roles?: string[];
  metric: StationMetric | undefined;
}

interface PaceChartProps {
  stations: ChartStation[];
  selectedRole: string | null;
  onSelect: (role: string) => void;
  /** Merge-glyph click — jump to the sequence that feeds this station. */
  onUpstreamSelect?: (upstreamRole: string) => void;
  /** Priority-badge click — open the station's queue oldest-first by its age facet. */
  /** Cmd/meta+click on a resolved dot — navigate to the role's full queue. */
  onCmdClick?: (role: string) => void;
  /** Selected window length in hours — target count = target_per_hour × this. */
  periodHours: number;
}

// ── SVG layout ────────────────────────────────────────────────────────────────

const W = 800;
const H = 270;
const ML = 40;
const MR = 76;
const MT = 24;
const MB = 72;

const chartW = W - ML - MR;
const chartH = H - MT - MB;
const bottom = MT + chartH;
const right = ML + chartW;

// Smooth transition applied when the window changes and values re-scale.
const EASE = '0.5s cubic-bezier(0.4, 0, 0.2, 1)';

// ── Path builders ─────────────────────────────────────────────────────────────

// A one-point curve still needs a stroke: a short segment — slightly longer
// than an em dash — centered through the point. It anchors the dot and its
// end label in vertical space when a sequence has a single station (or a
// single station carries a target).
const SOLO_HALF = 9;
function soloSegment(p: { x: number; y: number }): string {
  return `M ${(p.x - SOLO_HALF).toFixed(1)} ${p.y.toFixed(1)} L ${(p.x + SOLO_HALF).toFixed(1)} ${p.y.toFixed(1)}`;
}

/** Catmull-Rom → cubic bezier — smooth curves for the target, actual, and active lines. */
function catmullPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return soloSegment(pts[0]);
  const segs: string[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1x = (p1.x + (p2.x - p0.x) / 6).toFixed(1);
    const cp1y = (p1.y + (p2.y - p0.y) / 6).toFixed(1);
    const cp2x = (p2.x - (p3.x - p1.x) / 6).toFixed(1);
    const cp2y = (p2.y - (p3.y - p1.y) / 6).toFixed(1);
    if (i === 0) segs.push(`M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`);
    segs.push(`C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`);
  }
  return segs.join(' ');
}

/**
 * Closed region between two curves — upper spline forward, lower spline back.
 * Used for the queue-composition bands: the vertical thickness at any station
 * is the count difference between the two curves.
 */
function bandPath(upper: { x: number; y: number }[], lower: { x: number; y: number }[]): string {
  if (upper.length < 2 || lower.length < 2) return '';
  const forward = catmullPath(upper);
  const rev = [...lower].reverse();
  const back = catmullPath(rev);
  // Drop the back path's leading M — the L below connects the two curves.
  const backSegs = back.slice(back.indexOf('C'));
  return `${forward} L ${rev[0].x.toFixed(1)} ${rev[0].y.toFixed(1)} ${backSegs} Z`;
}

function compact(n: number): string {
  return n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function last<T>(a: T[]): T | undefined {
  return a.length > 0 ? a[a.length - 1] : undefined;
}

// ── Colors ────────────────────────────────────────────────────────────────────

// Shared queue-state palette — the chart bands and the station table columns
// use the same hues so the two views read as one. Each hue resolves through
// a --lt-* theme token so registered themes (including dark) restyle the
// chart; the navy default keeps the original sky/orange/green/slate look.
export const ACTIVE_COLOR = 'rgb(var(--lt-status-claimed-graphic))';   // claimed, being worked right now — orange
export const QUEUED_COLOR = 'rgb(var(--lt-status-queued-graphic))';    // pending and unclaimed, waiting in the queue — sky
export const RESOLVED_COLOR = 'rgb(var(--lt-status-success-graphic))'; // done — green
export const TARGET_COLOR = 'rgb(var(--lt-text-quaternary))';          // target pace line — muted gray

// Priority — unclaimed items past the role's age threshold, the count the
// floor pulls to the front of the rack.
// Jeopardy shares one red across the product (the pill, the table sub-row,
// this chart's badge) — the hard-limit alarm, distinct from every pace hue.
export const PRIORITY_COLOR = 'rgb(var(--lt-status-error))';
export const PRIORITY_TEXT_COLOR = 'rgb(var(--lt-status-error))';

/** Translucent tint of a token-based `rgb(var(--…))` color, for band fills. */
export function withAlpha(color: string, alpha: number): string {
  return color.replace(/\)$/, ` / ${alpha})`);
}

// ── End-label stacking — spread close labels so text doesn't collide ────────────

const MIN_GAP = 13;
function spreadLabels<T extends { y: number }>(labels: T[], maxY: number): (T & { labelY: number })[] {
  const sorted = [...labels].sort((a, b) => a.y - b.y);
  let prev = -Infinity;
  const placed = sorted.map((l) => {
    const labelY = Math.max(l.y + 3, prev + MIN_GAP);
    prev = labelY;
    return { ...l, labelY };
  });
  // On a quiet window every curve sits at zero and the stack would descend
  // past the floor into the station titles — lift the whole stack back above
  // maxY instead.
  const overflow = placed.length > 0 ? placed[placed.length - 1].labelY - maxY : 0;
  if (overflow > 0) {
    for (const l of placed) l.labelY -= overflow;
  }
  return placed;
}

// ── Chart ─────────────────────────────────────────────────────────────────────

export function PaceChart({ stations, selectedRole, onSelect, onUpstreamSelect, onCmdClick, periodHours }: PaceChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const n = stations.length;
  if (n === 0) return null;

  const xOf = (i: number) => (n === 1 ? ML + chartW / 2 : ML + (i / (n - 1)) * chartW);
  const xMap = new Map(stations.map((s, i) => [s.role, xOf(i)]));

  // Per-station counts for the selected window:
  // - target : expected units = target_per_hour × periodHours (e.g. 22/h · 15m ≈ 5).
  // - actual : units resolved in the window ("the number we see").
  // - active : units in the queue being worked right now (claimed).
  const rows = stations.map((s, i) => {
    const target = s.target_per_hour ?? null;
    const expected = target != null ? target * periodHours : null;
    return {
      idx: i,
      x: xOf(i),
      expected,
      actual: s.metric?.resolved ?? 0,
      active: s.metric?.claimed ?? 0,
      pending: s.metric?.pending ?? 0,
      priorityCount: s.metric?.priority_count ?? 0,
    };
  });

  const hasTargets = rows.some((r) => r.expected != null);

  const dataMax = Math.max(
    1,
    ...rows.map((r) => r.expected ?? 0),
    ...rows.map((r) => r.actual),
    ...rows.map((r) => (r.expected != null ? r.pending : 0)),
  );
  const maxVal = dataMax * 1.15;
  const yScale = (v: number) => MT + chartH * (1 - Math.max(0, Math.min(v, maxVal)) / maxVal);

  const withTarget = rows.filter((r) => r.expected != null);
  const targetPts = withTarget.map((r) => ({ ...r, y: yScale(r.expected as number) }));
  const actualPts = withTarget.map((r) => ({ ...r, y: yScale(r.actual) }));
  const activePts = withTarget.map((r) => ({ ...r, y: yScale(r.active) }));
  const pendingPts = withTarget.map((r) => ({ ...r, y: yScale(r.pending) }));

  const targetLinePath = catmullPath(targetPts);
  const actualSplinePath = catmullPath(actualPts);
  const activeSplinePath = catmullPath(activePts);
  const pendingSplinePath = catmullPath(pendingPts);

  const lastActual = last(actualPts);
  const lastTarget = last(targetPts);
  const lastActive = last(activePts);
  const lastPending = last(pendingPts);

  const areaPath =
    actualPts.length >= 2 && lastActual
      ? `${actualSplinePath} L ${lastActual.x.toFixed(1)} ${bottom} L ${actualPts[0].x.toFixed(1)} ${bottom} Z`
      : '';

  // Queue composition — pending splits into two stacked bands:
  //   floor → active curve   = claimed, being worked (indigo)
  //   active → pending curve = waiting, unclaimed (sky)
  // When workers claim everything the instant it lands, the sky band collapses
  // to zero and the whole queue reads as indigo.
  const hasQueue = withTarget.some((r) => r.pending > 0 || r.active > 0);
  const workedBandPath =
    hasQueue && activePts.length >= 2 && lastActive
      ? `${activeSplinePath} L ${lastActive.x.toFixed(1)} ${bottom} L ${activePts[0].x.toFixed(1)} ${bottom} Z`
      : '';
  const queuedBandPath = hasQueue ? bandPath(pendingPts, activePts) : '';

  // Quiet lines keep their curves (flat at zero) but skip their end labels —
  // a stack of names pointing at nothing is noise.
  const showActiveLabel = withTarget.some((r) => r.active > 0);
  const showQueuedLabel = withTarget.some((r) => r.pending > r.active);
  const endLabels = spreadLabels(
    [
      lastTarget ? { key: 'target', text: 'Target', color: TARGET_COLOR, y: lastTarget.y } : null,
      lastActual ? { key: 'actual', text: 'Resolved', color: RESOLVED_COLOR, y: lastActual.y } : null,
      showActiveLabel && lastActive
        ? { key: 'active', text: 'Claimed', color: ACTIVE_COLOR, y: lastActive.y }
        : null,
      showQueuedLabel && lastPending
        ? { key: 'queued', text: 'Pending', color: QUEUED_COLOR, y: lastPending.y }
        : null,
    ].filter(Boolean) as { key: string; text: string; color: string; y: number }[],
    bottom + 4,
  );

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
      {/* Dependency connector lines (parent → child), drawn at chart floor */}
      {stations.map((s) => {
        if (!s.parent_role) return null;
        const px = xMap.get(s.parent_role);
        if (px == null) return null;
        const cx = xOf(stations.findIndex((r) => r.role === s.role));
        return <line key={`dep-${s.role}`} x1={px} y1={bottom} x2={cx} y2={bottom} className="stroke-surface-border" strokeWidth={0.75} />;
      })}

      {/* Area under the actual curve */}
      {areaPath && <path d={areaPath} opacity={0.05} style={{ fill: RESOLVED_COLOR, transition: `d ${EASE}` }} />}

      {/* Queue composition bands — the band heights split each station's
          pending total into claimed-and-worked (indigo, floor→active) and
          waiting-unclaimed (sky, active→pending). */}
      {workedBandPath && (
        <path d={workedBandPath} opacity={0.12} style={{ fill: ACTIVE_COLOR, transition: `d ${EASE}` }} />
      )}
      {queuedBandPath && (
        <path d={queuedBandPath} opacity={0.12} style={{ fill: QUEUED_COLOR, transition: `d ${EASE}` }} />
      )}

      {/* Target — dashed reference curve at the window's expected count */}
      {targetLinePath && (
        <path d={targetLinePath} fill="none" strokeWidth={0.75} strokeDasharray="2 3" strokeLinecap="round" opacity={0.7} style={{ stroke: TARGET_COLOR, transition: `d ${EASE}` }} />
      )}

      {/* Per-station target markers — a small emerald dot on the target line
          (mirroring the Resolved line's dots) with the window's expected count
          (target_per_hour × duration) just above it */}
      {targetPts.map((tp) => (
        <g key={`tval-${tp.idx}`} transform={`translate(${tp.x} ${tp.y})`} style={{ transition: `transform ${EASE}` }}>
          <circle r={2} opacity={0.8} style={{ fill: TARGET_COLOR }} />
          <text
            y={-5}
            textAnchor="middle"
            fontSize={6.5}
            fontFamily="ui-monospace, monospace"
            fontWeight="500"
            opacity={0.7}
            style={{ fill: TARGET_COLOR }}
          >
            {Math.round(tp.expected as number)}
          </text>
        </g>
      ))}

      {/* Pending — thin dotted sky edge along the queue total (top of the bands) */}
      {hasQueue && pendingSplinePath && (
        <path d={pendingSplinePath} fill="none" strokeWidth={0.75} strokeDasharray="2 3" strokeLinecap="round" opacity={0.55} style={{ stroke: QUEUED_COLOR, transition: `d ${EASE}` }} />
      )}

      {/* Active — thin dotted indigo, how many are claimed and being worked */}
      {activeSplinePath && (
        <path d={activeSplinePath} fill="none" strokeWidth={0.75} strokeDasharray="2 3" strokeLinecap="round" opacity={0.5} style={{ stroke: ACTIVE_COLOR, transition: `d ${EASE}` }} />
      )}

      {/* Actual — thin solid, primary line */}
      {actualSplinePath && (
        <path d={actualSplinePath} fill="none" strokeWidth={0.6} strokeLinejoin="round" strokeLinecap="round" opacity={0.65} style={{ stroke: RESOLVED_COLOR, transition: `d ${EASE}` }} />
      )}

      {/* Queue markers — a dot on the active line per station.
          Above the dot, at the pending edge: the queue total (sky when part of
          it is still waiting, slate when everything is claimed).
          Below the dot: active (claimed, being worked right now). */}
      {activePts.map((ap, i) => {
        if (ap.pending <= 0 && ap.active <= 0) return null;
        const ar = Math.max(2.5, Math.min(5, 2.5 + ap.active / 10));
        const hasWaiting = ap.pending > ap.active;
        // Anchor the queue-total label to the pending edge so it rides the top
        // of the band; keep it clear of the dot when the two curves touch.
        const pendingLabelY = Math.min(pendingPts[i].y - 4, ap.y - ar - 4);
        return (
          <g key={`active-${ap.idx}`}>
            {ap.pending > 0 && (
              <text
                x={ap.x}
                y={pendingLabelY}
                textAnchor="middle"
                fontSize={7.5}
                fontFamily="ui-monospace, monospace"
                fontWeight="600"
                style={{ fill: hasWaiting ? QUEUED_COLOR : 'rgb(var(--lt-text-tertiary))', transition: `y ${EASE}` }}
              >
                {ap.pending}
              </text>
            )}
            <g transform={`translate(${ap.x} ${ap.y})`} style={{ transition: `transform ${EASE}` }}>
              <circle r={ar} opacity={0.85} style={{ fill: ACTIVE_COLOR }} />
              {ap.active > 0 && (
                <text y={ar + 9} textAnchor="middle" fontSize={7.5} fontFamily="ui-monospace, monospace" fontWeight="600" style={{ fill: ACTIVE_COLOR }}>
                  {ap.active}
                </text>
              )}
            </g>
          </g>
        );
      })}

      {/* Station nodes — actual (resolved) as a dot on the actual line, styled like
          the active dot but a bit larger (actual is the most important number).
          The count sits below the dot so it stays legible as numbers grow. */}
      {rows.map((row) => {
        const s = stations[row.idx];
        const x = row.x;
        const cy = row.expected != null ? yScale(row.actual) : bottom;
        // Same small scale as the active dot — a hair larger.
        const r = Math.max(2.25, Math.min(4, 2.25 + row.actual / 160));
        const isSelected = s.role === selectedRole;
        const isHovered = hoveredIdx === row.idx;

        const tooltip =
          row.expected == null
            ? 'idle · set a target rate to plot pace'
            : `${row.actual} resolved · target ${Math.round(row.expected)}`
              + (row.pending > row.active ? ` · ${row.pending - row.active} pending` : '')
              + (row.active > 0 ? ` · ${row.active} claimed` : '')
              + (row.priorityCount > 0 ? ` · ${row.priorityCount} in jeopardy` : '');
        const tipW = tooltip.length * 5.5 + 20;
        const tipX = Math.max(ML + tipW / 2 + 4, Math.min(right - tipW / 2 - 4, x));
        const tipY = cy - r - 10;

        return (
          <g
            key={s.role}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey) {
                e.stopPropagation();
                onCmdClick?.(s.role);
              } else {
                onSelect(s.role);
              }
            }}
            onMouseEnter={() => setHoveredIdx(row.idx)}
            onMouseLeave={() => setHoveredIdx(null)}
            style={{ cursor: 'pointer' }}
          >
            {/* Animated marker group — slides vertically as the window rescales */}
            <g transform={`translate(${x} ${cy})`} style={{ transition: `transform ${EASE}` }}>
              <circle r={22} fill="transparent" />
              <circle r={r} opacity={0.9} style={{ fill: RESOLVED_COLOR, transition: `r ${EASE}` }} />
              {row.expected != null && (
                <text y={-r - 5} textAnchor="middle" fontSize={9.5} fontFamily="ui-monospace, monospace" fontWeight="500" style={{ fill: RESOLVED_COLOR }}>
                  {compact(row.actual)}
                </text>
              )}
              {isHovered && !isSelected && <circle r={r + 3} fill="none" strokeWidth={1} opacity={0.4} style={{ stroke: RESOLVED_COLOR }} />}
              {isSelected && <circle r={r + 4} fill="none" className="stroke-accent" strokeWidth={2} />}
            </g>


            {/* Merge affordance — this station also receives input from another
                sequence. The dashed drop into the floor says "a side-quest
                lands here"; clicking it opens that sequence. It is a symbol,
                deliberately not a line — the upstream is NOT a descendant. */}
            {(s.upstream_roles?.length ?? 0) > 0 && (
              <g
                transform={`translate(${x - 20} ${bottom})`}
                onClick={(e) => {
                  e.stopPropagation();
                  onUpstreamSelect?.(s.upstream_roles![0]);
                }}
                style={{ cursor: 'pointer' }}
              >
                <title>{`Fed by ${s.upstream_roles!.join(', ')} — click to view that sequence`}</title>
                <circle r={9} cy={-6} fill="transparent" />
                <path d="M -7 -14 C -3 -14 -1 -9 0 -2" fill="none" className="stroke-text-quaternary" strokeWidth={1} strokeDasharray="2 2" strokeLinecap="round" />
                <path d="M 0 -2 L 8 -2" className="stroke-text-quaternary" strokeWidth={1} strokeLinecap="round" />
                <path d="M 8 -2 l -3.5 -2 v 4 z" className="fill-text-quaternary" />
              </g>
            )}

            {/* Station label — the display name (user-set title, or derived
                from the role id). The exact id lives in the table below.
                Adjacent labels alternate depth from the baseline so dense
                sequences don't collide. */}
            <text
              x={x}
              y={bottom + (row.idx % 2 === 0 ? 14 : 27)}
              textAnchor="middle"
              fontSize={9.5}
              className="fill-text-tertiary"
              fontFamily="ui-sans-serif, sans-serif"
              fontWeight="500"
            >
              {displayRoleTitle(s)}
            </text>

            {/* Tooltip */}
            {isHovered && (
              <g>
                <rect x={tipX - tipW / 2} y={tipY - 16} width={tipW} height={19} rx={3} className="fill-text-primary" opacity={0.88} />
                <text x={tipX} y={tipY - 3} textAnchor="middle" fontSize={8.5} className="fill-surface" fontFamily="ui-monospace, monospace">
                  {tooltip}
                </text>
              </g>
            )}
          </g>
        );
      })}

      {/* No-target hint */}
      {!hasTargets && (
        <text x={ML + chartW / 2} y={bottom + 48} textAnchor="middle" fontSize={8.5} className="fill-text-quaternary" fontFamily="ui-sans-serif, sans-serif">
          Set target_per_hour on each role in Admin → Roles to enable the pace chart
        </text>
      )}

      {/* End labels — text + count, rendered last so they sit above everything */}
      {endLabels.map((l) => (
        <text
          key={l.key}
          x={right + 6}
          y={l.labelY}
          fontSize={8}
          fontFamily="ui-sans-serif, sans-serif"
          fontWeight={l.key === 'actual' ? 700 : 500}
          opacity={l.key === 'active' ? 0.85 : 1}
          style={{ fill: l.color, transition: `y ${EASE}` }}
        >
          {l.text}
        </text>
      ))}
    </svg>
  );
}
