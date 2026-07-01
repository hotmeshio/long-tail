import { useState } from 'react';
import type { StationMetric } from '../../api/escalations';

export interface ChartStation {
  role: string;
  title: string | null;
  target_per_hour: number | null;
  parent_role: string | null;
  metric: StationMetric | undefined;
}

interface MembraneChartProps {
  stations: ChartStation[];
  selectedRole: string | null;
  onSelect: (role: string) => void;
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

// ── Catmull-Rom → cubic bezier ────────────────────────────────────────────────

function catmullPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
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

// ── Chart ─────────────────────────────────────────────────────────────────────

export function MembraneChart({ stations, selectedRole, onSelect }: MembraneChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const n = stations.length;
  if (n === 0) return null;

  const xOf = (i: number) =>
    n === 1 ? ML + chartW / 2 : ML + (i / (n - 1)) * chartW;

  // Index for looking up parent x
  const xMap = new Map(stations.map((s, i) => [s.role, xOf(i)]));

  // Solid curve — trend line (claimed / target_per_hour).
  // Answers: "at the current in-flight rate, will we over- or under-produce?"
  // Sits at 0 when nothing is claimed (no signal); rises when work is actively in progress.
  // Color of circles derives from this ratio: amber = over-pace, red = under-pace, green = on track.
  // Zero claimed = no signal = gray circles (dividing by 0 gives no meaningful trend).
  const trendPts = stations
    .map((s, i) => {
      if (!s.target_per_hour) return null;
      const claimed = s.metric?.claimed ?? 0;
      return { idx: i, x: xOf(i), ratio: claimed / s.target_per_hour };
    })
    .filter(Boolean) as { idx: number; x: number; ratio: number }[];

  // Dotted curve — period throughput efficiency (resolved / expected × 100%).
  // Shows what was actually produced in the selected window vs the target rate.
  const throughputPts = stations
    .map((s, i) => {
      if (!s.target_per_hour || s.metric?.throughput_pct == null) return null;
      return { idx: i, x: xOf(i), ratio: s.metric.throughput_pct / 100 };
    })
    .filter(Boolean) as { idx: number; x: number; ratio: number }[];

  const hasTargets = trendPts.length > 0 || throughputPts.length > 0;
  const maxRatio = Math.max(
    2.0,
    ...trendPts.map((p) => p.ratio),
    ...throughputPts.map((p) => p.ratio),
  );
  const yScale = (r: number) => MT + chartH * (1 - r / maxRatio);
  const baseline = yScale(1.0);

  const trendSplinePts = trendPts.map((p) => ({ x: p.x, y: yScale(p.ratio) }));
  const trendSplinePath = catmullPath(trendSplinePts);
  const throughputSplinePts = throughputPts.map((p) => ({ x: p.x, y: yScale(p.ratio) }));
  const throughputSplinePath = catmullPath(throughputSplinePts);

  const areaPath =
    trendSplinePts.length >= 2
      ? `${trendSplinePath} L ${trendSplinePts.at(-1)!.x.toFixed(1)} ${bottom} L ${trendSplinePts[0].x.toFixed(1)} ${bottom} Z`
      : '';

  // Right-side end labels — avoid collision when lines are close together.
  // Each label tries y = lineEndY + 3.5; if within MIN_GAP of a prior label,
  // flip above the line or nudge below so text doesn't stack.
  const MIN_GAP = 11;
  const targetLabelY = baseline + 3.5;

  const effRawEndY = throughputSplinePts.at(-1)?.y ?? null;
  const effLabelY =
    effRawEndY != null
      ? Math.abs(effRawEndY + 3.5 - targetLabelY) < MIN_GAP
        ? effRawEndY - MIN_GAP        // flip above the line to avoid "target" label
        : effRawEndY + 3.5
      : null;

  const trendRawEndY = trendSplinePts.at(-1)?.y ?? null;
  const trendLabelY =
    trendRawEndY != null
      ? effLabelY != null && Math.abs(trendRawEndY + 3.5 - effLabelY) < MIN_GAP
        ? effLabelY + MIN_GAP
        : Math.abs(trendRawEndY + 3.5 - targetLabelY) < MIN_GAP
        ? targetLabelY + MIN_GAP
        : trendRawEndY + 3.5
      : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
      <defs>
        <clipPath id="mc-below">
          <rect x={ML} y={baseline} width={chartW} height={bottom - baseline + 1} />
        </clipPath>
        <clipPath id="mc-above">
          <rect x={ML} y={MT} width={chartW} height={Math.max(0, baseline - MT)} />
        </clipPath>
      </defs>


      {/* Dependency connector lines (parent → child), drawn at baseline */}
      {stations.map((s) => {
        if (!s.parent_role) return null;
        const px = xMap.get(s.parent_role);
        if (px == null) return null;
        const cx = xOf(stations.findIndex((r) => r.role === s.role));
        return (
          <line
            key={`dep-${s.role}`}
            x1={px}
            y1={baseline}
            x2={cx}
            y2={baseline}
            stroke="#e2e8f0"
            strokeWidth={1}
          />
        );
      })}

      {/* 100% baseline — dashed, slightly more prominent */}
      <line
        x1={ML}
        y1={baseline}
        x2={right}
        y2={baseline}
        stroke="#94a3b8"
        strokeDasharray="6 3"
        strokeWidth={1}
      />
      <text
        x={right + 6}
        y={targetLabelY}
        fontSize={8.5}
        fill="#94a3b8"
        fontFamily="ui-sans-serif, sans-serif"
        fontWeight="500"
      >
        target
      </text>

      {/* Area fills under trend curve */}
      {areaPath && (
        <>
          <path d={areaPath} fill="rgb(52 211 153 / 0.10)" clipPath="url(#mc-below)" />
          <path d={areaPath} fill="rgb(245 158 11 / 0.09)" clipPath="url(#mc-above)" />
        </>
      )}

      {/* Actual throughput curve — solid, shows period output vs target rate. */}
      {throughputSplinePath && (
        <path
          d={throughputSplinePath}
          fill="none"
          stroke="#6366f1"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity={0.7}
        />
      )}

      {/* Per-point dots + % labels on the actual line — each station's throughput */}
      {throughputPts.map((tp, tpIdx) => {
        const pct = stations[tp.idx].metric?.throughput_pct;
        if (pct == null) return null;
        const y = yScale(tp.ratio);
        const isLast = tpIdx === throughputPts.length - 1;
        return (
          <g key={`eff-pt-${tp.idx}`}>
            <circle cx={tp.x} cy={y} r={2.5} fill="#6366f1" opacity={0.7} />
            {/* Suppress label on last point — end label already shows it */}
            {!isLast && (
              <text
                x={tp.x}
                y={y - 7}
                textAnchor="middle"
                fontSize={7.5}
                fill="#6366f1"
                fontFamily="ui-monospace, monospace"
                fontWeight="500"
                opacity={0.75}
              >
                {Math.round(pct)}%
              </text>
            )}
          </g>
        );
      })}

      {/* Trend curve — dotted, shows current in-flight work rate vs target */}
      {trendSplinePath && (
        <path
          d={trendSplinePath}
          fill="none"
          stroke="#1e293b"
          strokeWidth={1.25}
          strokeDasharray="5 3"
          strokeLinecap="round"
          opacity={0.5}
        />
      )}

      {/* Station circles + labels */}
      {stations.map((s, i) => {
        const x = xOf(i);
        const trendEntry = trendPts.find((p) => p.idx === i);
        const pending    = s.metric?.pending    ?? 0;
        const claimed    = s.metric?.claimed    ?? 0;
        const resolved   = s.metric?.resolved   ?? 0;
        const inArrears  = s.metric?.in_arrears ?? 0;

        // Circle tracks the solid trend curve (claimed/target).
        const trendRatio = trendEntry ? trendEntry.ratio : null;
        const cy = trendEntry != null ? yScale(trendEntry.ratio) : baseline;

        // Circle radius: 75% of original scale; always at least 10 so it's clickable
        const r = Math.max(10, Math.min(16, Math.round((9 + pending / 12) * 0.75)));

        const isSelected = s.role === selectedRole;
        const isHovered  = hoveredIdx === i;

        // Circles are always gray — color lives in the trend/actual lines, not the circles.
        const stroke = '#cbd5e1';
        const fill   = '#f1f5f9';  // slightly more opaque so circle masks lines underneath

        const hasSignal = claimed > 0;
        const tooltip =
          !s.target_per_hour
            ? 'idle · no target set'
            : !hasSignal
            ? `idle · nothing in flight${resolved > 0 ? ` · ${resolved} resolved` : ''}`
            : `${claimed} in flight · ${Math.round((trendRatio ?? 0) * 100)}% of target pace`;

        // Clamp tooltip so it doesn't go outside the viewBox
        const tipW = tooltip.length * 5.8 + 20;
        const tipX = Math.max(ML + tipW / 2 + 4, Math.min(right - tipW / 2 - 4, x));
        const tipY = cy - r - 10;

        return (
          <g
            key={s.role}
            onClick={() => onSelect(s.role)}
            onMouseEnter={() => setHoveredIdx(i)}
            onMouseLeave={() => setHoveredIdx(null)}
            style={{ cursor: 'pointer' }}
          >
            {/* Invisible large hit area — always 22px radius */}
            <circle cx={x} cy={cy} r={22} fill="transparent" />

            {/* Arrears dashed ring */}
            {inArrears > 0 && (
              <circle
                cx={x}
                cy={cy}
                r={r + 6}
                fill="none"
                stroke="#ef4444"
                strokeWidth={1.5}
                strokeDasharray="3 2"
                opacity={0.65}
              />
            )}

            {/* Station circle — filled, always visible */}
            <circle
              cx={x}
              cy={cy}
              r={r}
              fill={fill}
              stroke={stroke}
              strokeWidth={2}
            />

            {/* Inner circle label: pending count if > 0, else nothing */}
            {pending > 0 && (
              <text
                x={x}
                y={cy + 3.5}
                textAnchor="middle"
                fontSize={r >= 13 ? 9 : 8}
                fill="#64748b"
                fontFamily="ui-monospace, monospace"
                fontWeight="600"
              >
                {pending}
              </text>
            )}

            {/* Hover glow ring */}
            {isHovered && !isSelected && (
              <circle
                cx={x}
                cy={cy}
                r={r + 4}
                fill="none"
                stroke={stroke}
                strokeWidth={1.5}
                opacity={0.35}
              />
            )}

            {/* Selected ring */}
            {isSelected && (
              <circle
                cx={x}
                cy={cy}
                r={r + 5}
                fill="none"
                stroke="#6366f1"
                strokeWidth={2.5}
              />
            )}

            {/* Station labels */}
            <text
              x={x}
              y={bottom + 14}
              textAnchor="middle"
              fontSize={9.5}
              fill="#475569"
              fontFamily="ui-sans-serif, sans-serif"
              fontWeight="500"
            >
              {s.title ?? s.role}
            </text>
            <text
              x={x}
              y={bottom + 26}
              textAnchor="middle"
              fontSize={8}
              fill="#94a3b8"
              fontFamily="ui-monospace, monospace"
            >
              {s.role}
            </text>

            {/* Three-number strip: pending · active · resolved */}
            {s.target_per_hour && (
              <text
                x={x}
                y={bottom + 42}
                textAnchor="middle"
                fontSize={7.5}
                fontFamily="ui-monospace, monospace"
                fill="#94a3b8"
              >
                <tspan fill={pending > 0 ? '#f59e0b' : '#cbd5e1'}>
                  {pending}↑
                </tspan>
                <tspan fill="#94a3b8"> · </tspan>
                <tspan fill={(s.metric?.claimed ?? 0) > 0 ? '#6366f1' : '#cbd5e1'}>
                  {s.metric?.claimed ?? 0}●
                </tspan>
                <tspan fill="#94a3b8"> · </tspan>
                <tspan fill={resolved > 0 ? '#10b981' : '#cbd5e1'} fontWeight="700">
                  {resolved}✓
                </tspan>
              </text>
            )}

            {/* Tooltip */}
            {isHovered && (
              <g>
                <rect
                  x={tipX - tipW / 2}
                  y={tipY - 16}
                  width={tipW}
                  height={19}
                  rx={3}
                  fill="#0f172a"
                  opacity={0.88}
                />
                <text
                  x={tipX}
                  y={tipY - 3}
                  textAnchor="middle"
                  fontSize={8.5}
                  fill="white"
                  fontFamily="ui-monospace, monospace"
                >
                  {tooltip}
                </text>
              </g>
            )}
          </g>
        );
      })}

      {/* No-target hint — below station labels, not overlaying circles */}
      {!hasTargets && (
        <text
          x={ML + chartW / 2}
          y={bottom + 48}
          textAnchor="middle"
          fontSize={8.5}
          fill="#94a3b8"
          fontFamily="ui-sans-serif, sans-serif"
        >
          Set target_per_hour on each role in Admin → Roles to enable the pressure curve
        </text>
      )}

      {/* End labels — rendered last so they sit above circles */}
      {effLabelY != null && (() => {
        const lastPct = throughputPts.at(-1) != null
          ? stations[throughputPts.at(-1)!.idx].metric?.throughput_pct ?? null
          : null;
        return (
          <text
            x={right + 6}
            y={effLabelY}
            fontSize={8}
            fill="#6366f1"
            fontFamily="ui-sans-serif, sans-serif"
            fontWeight="600"
            opacity={0.85}
          >
            actual
            {lastPct != null && (
              <tspan x={right + 6} dy="10" fontSize={7.5} fontWeight="400" fontFamily="ui-monospace, monospace">
                {Math.round(lastPct)}%
              </tspan>
            )}
          </text>
        );
      })()}
      {trendLabelY != null && (
        <text
          x={right + 6}
          y={trendLabelY}
          fontSize={8}
          fill="#1e293b"
          fontFamily="ui-sans-serif, sans-serif"
          fontWeight="600"
          opacity={0.65}
        >
          trend
        </text>
      )}
    </svg>
  );
}
