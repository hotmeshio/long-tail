import { useState, type ReactNode } from 'react';
import { SectionLabel } from './SectionLabel';

// ---------------------------------------------------------------------------
// JSON view — raw, collapsible syntax tree (existing)
// ---------------------------------------------------------------------------

function JsonNode({ data, depth = 0 }: { data: unknown; depth?: number }) {
  const [collapsed, setCollapsed] = useState(depth > 1);

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
              <JsonNode data={item} depth={depth + 1} />
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
              <JsonNode data={value} depth={depth + 1} />
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

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function TreeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h8M4 18h12" />
    </svg>
  );
}

function CodeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7l-5 5 5 5M16 7l5 5-5 5" />
    </svg>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

type ViewMode = 'json' | 'tree';

export function JsonViewer({
  data,
  label,
}: {
  data: unknown;
  label?: ReactNode;
}) {
  const [mode, setMode] = useState<ViewMode>('json');
  const [copied, setCopied] = useState(false);

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

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        {label ? <SectionLabel>{label}</SectionLabel> : <span />}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMode(mode === 'json' ? 'tree' : 'json')}
            className={iconBtn}
            title={mode === 'json' ? 'Switch to tree view' : 'Switch to JSON view'}
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
      <div className="font-mono text-xs leading-relaxed bg-surface-sunken rounded-md p-4 overflow-x-auto">
        {mode === 'json' ? <JsonNode data={parsed} /> : <TreeNode data={parsed} />}
      </div>
    </div>
  );
}
