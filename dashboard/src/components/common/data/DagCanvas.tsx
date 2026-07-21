import { useMemo, useRef, useState, useEffect } from 'react';
import type { ActivityManifestEntry } from '../../../api/types';
import { styleFor, deriveEdges, assignLayers, ROW_H, BAR_TOP, BAR_H, LABEL_REM } from './dag-canvas-layout';

// ── Component ───────────────────────────────────────────────────────────────

interface DagCanvasProps {
  manifest: ActivityManifestEntry[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  yaml?: string;
}

export function DagCanvas({ manifest, selectedId, onSelect, yaml }: DagCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [graphW, setGraphW] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const labelPx = LABEL_REM * parseFloat(getComputedStyle(document.documentElement).fontSize);
      setGraphW(el.clientWidth - labelPx);
    };
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const { edges, layerMap, numLayers, sortedEntries, rowIndex } = useMemo(() => {
    const edges = deriveEdges(manifest, yaml);
    const layerMap =
      edges.length > 0
        ? assignLayers(manifest, edges)
        : new Map(manifest.map((e, i) => [e.activity_id, i]));
    const numLayers = Math.max(1, ...Array.from(layerMap.values())) + 1;

    // Sort by layer, preserve original order within same layer
    const indexed = manifest.map((e, i) => ({ entry: e, origIdx: i }));
    indexed.sort((a, b) => {
      const la = layerMap.get(a.entry.activity_id) ?? 0;
      const lb = layerMap.get(b.entry.activity_id) ?? 0;
      return la !== lb ? la - lb : a.origIdx - b.origIdx;
    });
    const sorted = indexed.map((x) => x.entry);
    const rowIndex = new Map(sorted.map((e, i) => [e.activity_id, i]));

    return { edges, layerMap, numLayers, sortedEntries: sorted, rowIndex };
  }, [manifest, yaml]);

  if (manifest.length === 0) {
    return <p className="text-xs text-text-tertiary italic">No activities in manifest</p>;
  }

  const graphH = sortedEntries.length * ROW_H;
  const barWidthPct = Math.max((0.7 / numLayers) * 100, 4);

  // Active tool_sources for legend
  const activeSources = [...new Set(manifest.map((e) => e.tool_source))];

  return (
    <div>
      {/* Legend */}
      <div className="flex items-center gap-3 mb-3">
        {activeSources.map((src) => {
          const s = styleFor(src);
          return (
            <div key={src} className="flex items-center gap-1">
              <span className={`w-2 h-2 rounded-full dot-ring ${s.dot}`} />
              <span className="text-2xs text-text-tertiary">{s.label}</span>
            </div>
          );
        })}
      </div>

      {/* Column headers — dependency depth axis */}
      <div className="flex">
        <div className="w-56 shrink-0" />
        <div className="flex-1 relative h-5 border-b border-surface-border">
          {Array.from({ length: numLayers }).map((_, i) => (
            <span
              key={i}
              className="absolute text-2xs font-mono text-text-tertiary bottom-1 -translate-x-1/2"
              style={{ left: `${((i + 0.5) / numLayers) * 100}%` }}
            >
              {i === 0 ? 'entry' : `step ${i}`}
            </span>
          ))}
        </div>
      </div>

      {/* Lanes + edge overlay */}
      <div ref={containerRef} className="relative">
        {sortedEntries.map((entry) => {
          const layer = layerMap.get(entry.activity_id) ?? 0;
          const barLeftPct = (layer / numLayers) * 100;
          const s = styleFor(entry.tool_source);
          const isSelected = selectedId === entry.activity_id;

          return (
            <div
              key={entry.activity_id}
              className={`flex items-center border-b border-surface-border cursor-pointer transition-colors ${
                isSelected ? 'bg-accent/5' : 'hover:bg-surface-raised/30'
              }`}
              style={{ height: ROW_H }}
              onClick={() => onSelect(isSelected ? null : entry.activity_id)}
            >
              {/* Lane label */}
              <div className="w-56 shrink-0 pr-4 flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full dot-ring shrink-0 ${s.dot}`} />
                <p
                  className="text-xs font-mono text-text-secondary truncate"
                  title={entry.title}
                >
                  {entry.title}
                </p>
              </div>

              {/* Graph area */}
              <div className="flex-1 relative h-full">
                {/* Grid lines */}
                {Array.from({ length: numLayers + 1 }).map((_, i) => (
                  <div
                    key={i}
                    className="absolute top-0 bottom-0 w-px bg-surface-border opacity-30"
                    style={{ left: `${(i / numLayers) * 100}%` }}
                  />
                ))}

                {/* Bar */}
                <div
                  className={`absolute rounded-sm transition-all ${s.bar} ${
                    isSelected
                      ? 'ring-2 ring-accent ring-offset-1 ring-offset-surface'
                      : 'hover:brightness-110'
                  }`}
                  style={{
                    left: `calc(${barLeftPct}% + 4px)`,
                    width: `calc(${barWidthPct}% - 8px)`,
                    top: BAR_TOP,
                    height: BAR_H,
                    minWidth: 40,
                  }}
                >
                  <span className="absolute inset-0 flex items-center px-2 text-2xs font-mono text-text-inverse truncate">
                    {entry.mcp_tool_name ?? entry.tool_source}
                  </span>
                </div>
              </div>
            </div>
          );
        })}

        {/* Edge overlay — dependency arrows between bars */}
        {edges.length > 0 && graphW > 0 && (
          <svg
            className="absolute top-0 left-56 pointer-events-none overflow-visible"
            style={{ width: graphW, height: graphH }}
          >
            <defs>
              <marker
                id="dag-edge-arrow"
                viewBox="0 0 10 8"
                refX="10"
                refY="4"
                markerWidth="6"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path d="M0 0 L10 4 L0 8 Z" className="fill-text-quaternary" opacity="0.6" />
              </marker>
            </defs>

            {edges.map((edge, i) => {
              const fromRow = rowIndex.get(edge.from) ?? 0;
              const toRow = rowIndex.get(edge.to) ?? 0;
              const fromLayer = layerMap.get(edge.from) ?? 0;
              const toLayer = layerMap.get(edge.to) ?? 0;

              // Bar geometry in pixels
              const colW = graphW / numLayers;
              const barW = Math.max(colW * 0.7 - 8, 40);

              // Source: right edge of source bar
              const x1 = fromLayer * colW + 4 + barW;
              const y1 = fromRow * ROW_H + ROW_H / 2;
              // Target: left edge of target bar
              const x2 = toLayer * colW + 4;
              const y2 = toRow * ROW_H + ROW_H / 2;

              // Bezier control points — horizontal bias for Gantt feel
              const dx = Math.abs(x2 - x1) * 0.4;

              return (
                <path
                  key={i}
                  d={`M${x1} ${y1} C${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  className="stroke-text-quaternary"
                  strokeWidth={1.5}
                  opacity={0.4}
                  markerEnd="url(#dag-edge-arrow)"
                />
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}
