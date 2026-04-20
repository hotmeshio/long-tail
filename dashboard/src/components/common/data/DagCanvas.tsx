import { useMemo, useRef, useState, useEffect } from 'react';
import type { ActivityManifestEntry } from '../../../api/types';

// ── Colors ──────────────────────────────────────────────────────────────────

const SOURCE_STYLES: Record<string, { bar: string; dot: string; hex: string; label: string }> = {
  trigger:   { bar: 'bg-[#6C47FF]',  dot: 'bg-[#6C47FF]',  hex: '#6C47FF', label: 'Trigger' },
  mcp:       { bar: 'bg-blue-500',    dot: 'bg-blue-500',    hex: '#3B82F6', label: 'MCP' },
  db:        { bar: 'bg-blue-500',    dot: 'bg-blue-500',    hex: '#3B82F6', label: 'Database' },
  llm:       { bar: 'bg-violet-500',  dot: 'bg-violet-500',  hex: '#8B5CF6', label: 'LLM' },
  transform: { bar: 'bg-emerald-500', dot: 'bg-emerald-500', hex: '#10B981', label: 'Transform' },
  signal:    { bar: 'bg-amber-500',   dot: 'bg-amber-500',   hex: '#F59E0B', label: 'Signal' },
};

function styleFor(source: string) {
  return SOURCE_STYLES[source] ?? { bar: 'bg-gray-500', dot: 'bg-gray-500', hex: '#6B7280', label: source };
}

// ── Graph helpers ───────────────────────────────────────────────────────────

interface Edge { from: string; to: string }

/** Recursively extract `{activityId.…}` refs from a mapping value (string or @pipe object). */
function extractMappingRefs(value: unknown): string[] {
  if (typeof value === 'string') {
    return [...value.matchAll(/\{([\w-]+)\./g)].map((m) => m[1]);
  }
  if (Array.isArray(value)) {
    return value.flatMap(extractMappingRefs);
  }
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(extractMappingRefs);
  }
  return [];
}

/** Derive dependency edges by parsing `{activityId.…}` refs in input_mappings. */
function deriveEdges(entries: ActivityManifestEntry[]): Edge[] {
  const idSet = new Set(entries.map((e) => e.activity_id));
  const edgeMap = new Map<string, Edge>();

  for (const entry of entries) {
    if (!entry.input_mappings) continue;
    for (const mapping of Object.values(entry.input_mappings)) {
      for (const src of extractMappingRefs(mapping)) {
        if (idSet.has(src) && src !== entry.activity_id) {
          const key = `${src}->${entry.activity_id}`;
          if (!edgeMap.has(key)) edgeMap.set(key, { from: src, to: entry.activity_id });
        }
      }
    }
  }

  return [...edgeMap.values()];
}

/** Longest-path layering — each node's layer = max(dependency layers) + 1. */
function assignLayers(entries: ActivityManifestEntry[], edges: Edge[]): Map<string, number> {
  const inDeps = new Map<string, string[]>();
  for (const e of entries) inDeps.set(e.activity_id, []);
  for (const edge of edges) inDeps.get(edge.to)?.push(edge.from);

  const layers = new Map<string, number>();

  function computeLayer(id: string, stack: Set<string>): number {
    if (layers.has(id)) return layers.get(id)!;
    if (stack.has(id)) return 0; // cycle guard
    stack.add(id);
    const deps = inDeps.get(id) ?? [];
    const layer = deps.length === 0 ? 0 : Math.max(...deps.map((d) => computeLayer(d, stack))) + 1;
    layers.set(id, layer);
    return layer;
  }

  for (const e of entries) computeLayer(e.activity_id, new Set());
  return layers;
}

// ── Layout constants ────────────────────────────────────────────────────────

const ROW_H = 44;
const BAR_TOP = 10;
const BAR_H = 24;
const LABEL_REM = 14; // w-56 = 14rem

// ── Component ───────────────────────────────────────────────────────────────

interface DagCanvasProps {
  manifest: ActivityManifestEntry[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function DagCanvas({ manifest, selectedId, onSelect }: DagCanvasProps) {
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
    const edges = deriveEdges(manifest);
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
  }, [manifest]);

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
              <span className={`w-2 h-2 rounded-full ${s.dot}`} />
              <span className="text-[9px] text-text-tertiary">{s.label}</span>
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
              className="absolute text-[9px] font-mono text-text-tertiary bottom-1 -translate-x-1/2"
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
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
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
                  <span className="absolute inset-0 flex items-center px-2 text-[9px] font-mono text-white truncate">
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
                <path d="M0 0 L10 4 L0 8 Z" fill="#6B7280" opacity="0.6" />
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
                  stroke="#6B7280"
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
