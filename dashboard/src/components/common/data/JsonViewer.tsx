import { useState, useCallback, useRef, type ReactNode } from 'react';
import { SectionLabel } from '../layout/SectionLabel';
import { FullscreenOverlay } from '../layout/FullscreenOverlay';
import { Maximize2, Minimize2 } from 'lucide-react';
import { TreeIcon, CodeIcon, CopyIcon, CheckIcon, CollapseIcon, ExpandIcon } from './JsonViewerIcons';
import { JsonNode, TreeNode } from './json-viewer-nodes';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ViewMode = 'json' | 'tree';

// ---------------------------------------------------------------------------
// Toolbar — shared between inline and fullscreen views
// ---------------------------------------------------------------------------

function JsonToolbar({ mode, setMode, isCollapsed, onToggleCollapse, onCopy, copied, onFullscreen, onClose, large }: {
  mode: ViewMode;
  setMode: (m: ViewMode) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onCopy: () => void;
  copied: boolean;
  onFullscreen?: () => void;
  onClose?: () => void;
  large?: boolean;
}) {
  const icon = large ? 'w-5 h-5' : 'w-3.5 h-3.5';
  const btn = `${large ? 'p-2' : 'p-1.5'} rounded text-text-tertiary hover:text-text-primary hover:bg-surface-raised transition-colors duration-150`;
  return (
    <div className="flex items-center gap-0.5 bg-surface-sunken/80 rounded-md backdrop-blur-sm">
      {mode === 'json' && (
        <button onClick={onToggleCollapse} className={btn} title={isCollapsed ? 'Expand all' : 'Collapse all'}>
          {isCollapsed ? <ExpandIcon className={icon} /> : <CollapseIcon className={icon} />}
        </button>
      )}
      <button onClick={() => setMode(mode === 'json' ? 'tree' : 'json')} className={btn} title={mode === 'json' ? 'Outline view' : 'JSON view'}>
        {mode === 'json' ? <TreeIcon className={icon} /> : <CodeIcon className={icon} />}
      </button>
      <button onClick={onCopy} className={btn} title="Copy to clipboard">
        {copied ? <CheckIcon className={`${icon} text-status-success`} /> : <CopyIcon className={icon} />}
      </button>
      {onFullscreen && (
        <button onClick={onFullscreen} className={btn} title="Fullscreen">
          <Maximize2 className={icon} />
        </button>
      )}
      {onClose && (
        <button onClick={onClose} className={btn} title="Close (Esc)">
          <Minimize2 className={icon} />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

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
  const containerRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<ViewMode>(defaultMode ?? 'json');
  const [copied, setCopied] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  // Bumping generation forces all JsonNodes to re-evaluate collapse state.
  // Even (incl. 0) = collapsed, odd = fully expanded.
  const [generation, setGeneration] = useState(defaultCollapsed ? 0 : 1);
  // Separate generation for fullscreen (always starts expanded)
  const [fsGeneration, setFsGeneration] = useState(1);
  const isGlobalCollapsed = generation % 2 === 0;
  const isFsCollapsed = fsGeneration % 2 === 0;
  const toggleGlobalCollapse = useCallback(() => setGeneration((g) => g + 1), []);
  const toggleFsCollapse = useCallback(() => setFsGeneration((g) => g + 1), []);

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

  const openFullscreen = useCallback(() => {
    setFsGeneration(1); // reset to expanded
    setFullscreen(true);
  }, []);

  const isPanel = variant === 'panel';
  const wrapperClass = isPanel
    ? 'border border-accent-muted/40 rounded-lg p-3 bg-surface-hover/30'
    : '';
  const contentClass = isPanel
    ? 'font-mono text-xs leading-relaxed bg-white rounded-md p-4 overflow-x-auto break-all'
    : 'font-mono text-xs leading-relaxed bg-surface-sunken rounded-md p-4 overflow-x-auto break-all';

  return (
    <div className={wrapperClass}>
      {label && <SectionLabel>{label}</SectionLabel>}
      <div ref={containerRef} className="relative">
        <div className="absolute top-2 right-2 z-[5]">
          <JsonToolbar
            mode={mode} setMode={setMode}
            isCollapsed={isGlobalCollapsed} onToggleCollapse={toggleGlobalCollapse}
            onCopy={handleCopy} copied={copied}
            onFullscreen={openFullscreen}
          />
        </div>
        <div className={contentClass}>
          {mode === 'json' ? <JsonNode data={parsed} generation={generation} /> : <TreeNode data={parsed} />}
        </div>
      </div>

      <FullscreenOverlay open={fullscreen} onClose={() => setFullscreen(false)} sourceRef={containerRef}>
        <div className="sticky top-0 float-right z-10">
          <JsonToolbar
            mode={mode} setMode={setMode}
            isCollapsed={isFsCollapsed} onToggleCollapse={toggleFsCollapse}
            onCopy={handleCopy} copied={copied}
            onClose={() => setFullscreen(false)}
            large
          />
        </div>
        <div className="font-mono text-sm leading-relaxed">
          {mode === 'json' ? <JsonNode data={parsed} generation={fsGeneration} /> : <TreeNode data={parsed} />}
        </div>
      </FullscreenOverlay>
    </div>
  );
}
