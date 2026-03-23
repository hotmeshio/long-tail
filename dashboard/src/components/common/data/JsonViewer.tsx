import { useState, useCallback, type ReactNode } from 'react';
import { SectionLabel } from '../layout/SectionLabel';

// ---------------------------------------------------------------------------
// JSON view — raw, collapsible syntax tree (existing)
// ---------------------------------------------------------------------------

function JsonNode({ data, depth = 0, generation }: { data: unknown; depth?: number; generation?: number }) {
  // Odd generation = fully expanded; even = collapsed (beyond depth 0).
  // generation 0 = default (collapsed). First click → gen 1 → expand all.
  const isExpandedGen = generation !== undefined && generation > 0 && generation % 2 === 1;
  const defaultCollapsed = isExpandedGen ? false : depth > 0;
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [lastGen, setLastGen] = useState(generation);

  // Reset local collapse state when global generation changes
  if (generation !== undefined && generation !== lastGen) {
    setLastGen(generation);
    setCollapsed(generation % 2 === 0 && depth > 0);
  }

  if (data === null || data === undefined) {
    return <span className="text-text-tertiary italic">null</span>;
  }

  if (typeof data === 'string') {
    return <span className="text-text-primary">&quot;{data}&quot;</span>;
  }

  if (typeof data === 'number' || typeof data === 'boolean') {
    return <span className="text-text-primary font-medium">{String(data)}</span>;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) return <span className="text-text-tertiary">[]</span>;

    if (collapsed) {
      return (
        <button
          onClick={() => setCollapsed(false)}
          className="text-text-secondary hover:text-text-primary"
        >
          [{data.length} items]
        </button>
      );
    }

    return (
      <span>
        <button
          onClick={() => setCollapsed(true)}
          className="text-text-tertiary hover:text-text-primary"
        >
          [
        </button>
        <div className="pl-4 border-l border-surface-border ml-1">
          {data.map((item, i) => (
            <div key={i}>
              <JsonNode data={item} depth={depth + 1} generation={generation} />
              {i < data.length - 1 && <span className="text-text-tertiary">,</span>}
            </div>
          ))}
        </div>
        <span className="text-text-tertiary">]</span>
      </span>
    );
  }

  if (typeof data === 'object') {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length === 0) return <span className="text-text-tertiary">{'{}'}</span>;

    if (collapsed) {
      return (
        <button
          onClick={() => setCollapsed(false)}
          className="text-text-secondary hover:text-text-primary"
        >
          {'{'}...{'}'}
        </button>
      );
    }

    return (
      <span>
        <button
          onClick={() => setCollapsed(true)}
          className="text-text-tertiary hover:text-text-primary"
        >
          {'{'}
        </button>
        <div className="pl-4 border-l border-surface-border ml-1">
          {entries.map(([key, value], i) => (
            <div key={key}>
              <span className="text-text-secondary">{key}</span>
              <span className="text-text-tertiary">: </span>
              <JsonNode data={value} depth={depth + 1} generation={generation} />
              {i < entries.length - 1 && <span className="text-text-tertiary">,</span>}
            </div>
          ))}
        </div>
        <span className="text-text-tertiary">{'}'}</span>
      </span>
    );
  }

  return <span>{String(data)}</span>;
}

// ---------------------------------------------------------------------------
// Tree / outline view — readable, document-like
// ---------------------------------------------------------------------------

function TreeNode({ data, depth = 0 }: { data: unknown; depth?: number }) {
  if (data === null || data === undefined) {
    return <span className="text-text-tertiary italic">null</span>;
  }

  if (typeof data === 'string') {
    return <span className="text-text-primary">{data}</span>;
  }

  if (typeof data === 'number' || typeof data === 'boolean') {
    return <span className="text-text-primary font-medium">{String(data)}</span>;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) return <span className="text-text-tertiary italic">empty list</span>;
    return (
      <div className="space-y-2">
        {data.map((item, i) => (
          <div key={i} className="flex items-baseline gap-2">
            <span className="text-text-tertiary text-[10px] shrink-0">{i + 1}.</span>
            <div className="flex-1">
              <TreeNode data={item} depth={depth + 1} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (typeof data === 'object') {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length === 0) return <span className="text-text-tertiary italic">empty</span>;
    return (
      <div className={depth > 0 ? 'pl-4 border-l border-surface-border space-y-3' : 'space-y-3'}>
        {entries.map(([key, value]) => {
          const isLeaf = value === null || typeof value !== 'object';
          return (
            <div key={key}>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-0.5">
                {key.replace(/[_-]/g, ' ')}
              </p>
              {isLeaf ? (
                <p className="text-sm text-text-primary">
                  <TreeNode data={value} depth={depth + 1} />
                </p>
              ) : (
                <TreeNode data={value} depth={depth + 1} />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return <span>{String(data)}</span>;
}

import { TreeIcon, CodeIcon, CopyIcon, CheckIcon, CollapseIcon, ExpandIcon } from './JsonViewerIcons';

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

type ViewMode = 'json' | 'tree';

export function JsonViewer({
  data,
  label,
  variant,
  defaultCollapsed = false,
  defaultMode,
}: {
  data: unknown;
  label?: ReactNode;
  /** Optional visual variant. `panel` adds a lavender border and lighter background. */
  variant?: 'default' | 'panel';
  /** Start with all nodes collapsed (default: false — root expanded, children collapsed). */
  defaultCollapsed?: boolean;
  /** Initial view mode. Defaults to 'json'. */
  defaultMode?: ViewMode;
}) {
  const [mode, setMode] = useState<ViewMode>(defaultMode ?? 'json');
  const [copied, setCopied] = useState(false);
  // Bumping generation forces all JsonNodes to re-evaluate collapse state.
  // Even (incl. 0) = collapsed, odd = fully expanded.
  const [generation, setGeneration] = useState(defaultCollapsed ? 0 : 0);
  const isGlobalCollapsed = generation % 2 === 0;
  const toggleGlobalCollapse = useCallback(() => setGeneration((g) => g + 1), []);

  let parsed = data;
  if (typeof data === 'string') {
    try {
      parsed = JSON.parse(data);
    } catch {
      // Not JSON, display as string
    }
  }

  const handleCopy = async () => {
    const text = typeof data === 'string' ? data : JSON.stringify(parsed, null, 2);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const iconBtn = 'p-1.5 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-raised transition-colors duration-150';

  const isPanel = variant === 'panel';
  const wrapperClass = isPanel
    ? 'border border-accent-muted/40 rounded-lg p-3 bg-surface-hover/30'
    : '';
  const contentClass = isPanel
    ? 'font-mono text-xs leading-relaxed bg-white rounded-md p-4 overflow-x-auto'
    : 'font-mono text-xs leading-relaxed bg-surface-sunken rounded-md p-4 overflow-x-auto';

  return (
    <div className={wrapperClass}>
      <div className="flex items-center justify-between mb-2">
        {label ? <SectionLabel>{label}</SectionLabel> : <span />}
        <div className="flex items-center gap-1">
          {mode === 'json' && (
            <button
              onClick={toggleGlobalCollapse}
              className={iconBtn}
              title={isGlobalCollapsed ? 'Expand all' : 'Collapse all'}
            >
              {isGlobalCollapsed ? (
                <ExpandIcon className="w-3.5 h-3.5" />
              ) : (
                <CollapseIcon className="w-3.5 h-3.5" />
              )}
            </button>
          )}
          <button
            onClick={() => setMode(mode === 'json' ? 'tree' : 'json')}
            className={iconBtn}
            title={mode === 'json' ? 'Switch to outline view' : 'Switch to JSON view'}
          >
            {mode === 'json' ? (
              <TreeIcon className="w-3.5 h-3.5" />
            ) : (
              <CodeIcon className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            onClick={handleCopy}
            className={iconBtn}
            title="Copy to clipboard"
          >
            {copied ? (
              <CheckIcon className="w-3.5 h-3.5 text-status-success" />
            ) : (
              <CopyIcon className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>
      <div className={contentClass}>
        {mode === 'json' ? <JsonNode data={parsed} generation={generation} /> : <TreeNode data={parsed} />}
      </div>
    </div>
  );
}
