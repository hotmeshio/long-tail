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
const ML = 12;
const MR = 48;
const MT = 24;
const MB = 56;

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

  // Solid curve — real-time queue pressure (pending / target).
  // Sits at 0 when queue is clear; only rises when backlog builds.
  const pressurePts = stations
    .map((s, i) => {
      if (!s.target_per_hour) return null;
      const pending = s.metric?.pending ?? 0;
      return { idx: i, x: xOf(i), pressure: pending / s.target_per_hour };
    })
    .filter(Boolean) as { idx: number; x: number; pressure: number }[];

  // Dotted curve — period throughput efficiency (resolved / expected × 100%).
  // Shows what was actually achieved in the selected window vs the target rate.
  // Switching from 15m (idle) to 1h (70 orders ran) lifts this curve above baseline.
  const throughputPts = stations
    .map((s, i) => {
      if (!s.target_per_hour || s.metric?.throughput_pct == null) return null;
      return { idx: i, x: xOf(i), pressure: s.metric.throughput_pct / 100 };
    })
    .filter(Boolean) as { idx: number; x: number; pressure: number }[];

  const hasTargets = pressurePts.length > 0 || throughputPts.length > 0;
  const maxPressure = Math.max(
    2.0,
    ...pressurePts.map((p) => p.pressure),
    ...throughputPts.map((p) => p.pressure),
  );
  const yScale = (p: number) => MT + chartH * (1 - p / maxPressure);
  const baseline = yScale(1.0);

  const splinePts = pressurePts.map((p) => ({ x: p.x, y: yScale(p.pressure) }));
  const splinePath = catmullPath(splinePts);
  const throughputSplinePts = throughputPts.map((p) => ({ x: p.x, y: yScale(p.pressure) }));
  const throughputSplinePath = catmullPath(throughputSplinePts);

  const areaPath =
    splinePts.length >= 2
      ? `${splinePath} L ${splinePts.at(-1)!.x.toFixed(1)} ${bottom} L ${splinePts[0].x.toFixed(1)} ${bottom} Z`
      : '';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
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
            strokeWidth={1.5}
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
        strokeWidth={1.25}
      />
      <text
        x={right + 6}
        y={baseline + 3.5}
        fontSize={8.5}
        fill="#94a3b8"
        fontFamily="ui-sans-serif, sans-serif"
        fontWeight="500"
      >
        100%
      </text>

      {/* Area fills under curve */}
      {areaPath && (
        <>
          <path d={areaPath} fill="rgb(52 211 153 / 0.10)" clipPath="url(#mc-below)" />
          <path d={areaPath} fill="rgb(245 158 11 / 0.09)" clipPath="url(#mc-above)" />
        </>
      )}

      {/* Throughput efficiency curve — dotted, shows period output vs target rate.
           Switching periods lifts/drops this curve; the baseline stays fixed at 100%. */}
      {throughputSplinePath && (
        <path
          d={throughputSplinePath}
          fill="none"
          stroke="#6366f1"
          strokeWidth={1.5}
          strokeDasharray="5 3"
          strokeLinecap="round"
          opacity={0.55}
        />
      )}
      {throughputSplinePts.length > 0 && (
        <text
          x={right + 6}
          y={throughputSplinePts.at(-1)!.y + 3.5}
          fontSize={8}
          fill="#6366f1"
          fontFamily="ui-sans-serif, sans-serif"
          opacity={0.7}
        >
          eff
        </text>
      )}

      {/* Membrane curve — solid, real-time queue pressure */}
      {splinePath && (
        <path
          d={splinePath}
          fill="none"
          stroke="#1e293b"
          strokeWidth={2.25}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}

      {/* Station circles + labels */}
      {stations.map((s, i) => {
        const x = xOf(i);
        const pEntry = pressurePts.find((p) => p.idx === i);
        const tEntry = throughputPts.find((p) => p.idx === i);
        const pending = s.metric?.pending ?? 0;
        const resolved = s.metric?.resolved ?? 0;
        const inArrears = s.metric?.in_arrears ?? 0;
        const throughputPct = s.metric?.throughput_pct ?? null;

        // Active queue pressure (only meaningful when pending > 0).
        const queuePressure = pEntry ? pEntry.pressure : null;
        // Circle sits on the queue-pressure curve when active, throughput curve when idle.
        const circlePressure = pEntry != null
          ? (pending > 0 ? queuePressure! : (tEntry?.pressure ?? 0))
          : null;
        const cy = circlePressure !== null ? yScale(circlePressure) : baseline;

        // Circle radius: always at least 13 so it's clickable; scales with pending
        const r = Math.max(13, Math.min(22, 9 + pending / 12));

        const isSelected = s.role === selectedRole;
        const isHovered = hoveredIdx === i;
        // Color semantics: only active backlog drives amber/red — idle is never red.
        const isHot  = pending > 0 && queuePressure != null && queuePressure > 1.0;
        const isUnder = pending > 0 && queuePressure != null && queuePressure < 0.2;
        const isIdle  = pending === 0;
        const idleHasData = isIdle && (resolved > 0 || (throughputPct != null && throughputPct > 0));
        const idleHot = isIdle && idleHasData && (throughputPct ?? 0) > 100;

        const stroke =
          circlePressure === null ? '#cbd5e1'
          : isHot   ? '#f59e0b'
          : isUnder ? '#f97316'
          : isIdle && !idleHasData ? '#cbd5e1'   // no data this period → grey
          : idleHot ? '#f59e0b'                   // high throughput period → amber
          : '#10b981';                             // healthy (active or good throughput)
        const fill =
          circlePressure === null ? '#f8fafc'
          : isHot   ? 'rgba(245,158,11,0.13)'
          : isUnder ? 'rgba(249,115,22,0.13)'
          : isIdle && !idleHasData ? '#f8fafc'
          : idleHot ? 'rgba(245,158,11,0.10)'
          : 'rgba(16,185,129,0.13)';

        const throughputLabel = throughputPct != null && throughputPct > 0
          ? `${Math.round(throughputPct)}% eff`
          : null;
        const tooltip =
          pending > 0
            ? `${pending} pending · ${Math.round((queuePressure ?? 0) * 100)}% pressure`
            : !s.target_per_hour
            ? 'idle · no target set'
            : throughputLabel
            ? `idle · ${throughputLabel}`
            : 'idle — no data this period';

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

            {/* Pending count — inside circle if big enough, above it if small */}
            {pending > 0 && (
              <text
                x={x}
                y={r >= 16 ? cy + 4 : cy - r - 5}
                textAnchor="middle"
                fontSize={r >= 16 ? 10 : 8.5}
                fill={stroke === '#cbd5e1' ? '#64748b' : isHot ? '#d97706' : isUnder ? '#ea580c' : '#059669'}
                fontFamily="ui-monospace, monospace"
                fontWeight="700"
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
              y={bottom + 17}
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
              y={bottom + 30}
              textAnchor="middle"
              fontSize={8}
              fill="#94a3b8"
              fontFamily="ui-monospace, monospace"
            >
              {s.role}
            </text>

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
    </svg>
  );
}
