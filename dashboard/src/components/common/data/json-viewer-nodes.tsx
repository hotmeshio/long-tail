import { useState } from 'react';
import { MarkdownRenderer, looksLikeMarkdown } from '../display/MarkdownRenderer';

// ---------------------------------------------------------------------------
// JSON view — raw, collapsible syntax tree
// ---------------------------------------------------------------------------

export function JsonNode({ data, depth = 0, generation }: { data: unknown; depth?: number; generation?: number }) {
  // Odd generation = fully expanded; even = collapsed (beyond depth 0).
  // generation 0 = default (collapsed). First click -> gen 1 -> expand all.
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

export function TreeNode({ data, depth = 0 }: { data: unknown; depth?: number }) {
  if (data === null || data === undefined) {
    return <span className="text-text-tertiary italic">null</span>;
  }

  if (typeof data === 'string') {
    if (data.length > 40 && looksLikeMarkdown(data)) {
      return <MarkdownRenderer content={data} />;
    }
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
