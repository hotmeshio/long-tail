import { useState, useRef, useEffect, useMemo } from 'react';
import { Server } from 'lucide-react';
import { useCapabilities } from '../../../api/capabilities';

/**
 * Searchable combobox for selecting a capability (MCP server tool).
 *
 * Searches across ALL tools from all servers in a single flat list.
 * Selecting a tool sets both serverId and toolName in one action.
 * Styled to match the TopicCombobox used for event topic selection.
 */
export function CapabilityCombobox({ serverId, toolName, onChange }: {
  serverId: string;
  toolName: string;
  onChange: (serverId: string, toolName: string) => void;
}) {
  const { data } = useCapabilities();
  const allTools = useMemo(
    () => data?.categories?.flatMap((c) => c.tools) ?? [],
    [data],
  );

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const displayValue = toolName ? `${toolName}` : '';
  const filterText = open ? filter : displayValue;

  const filtered = useMemo(() => {
    const q = (open ? filter : '').toLowerCase();
    if (!q) return allTools;
    return allTools.filter((t) =>
      t.name.toLowerCase().includes(q) ||
      t.serverName.toLowerCase().includes(q) ||
      (t.description ?? '').toLowerCase().includes(q),
    );
  }, [allTools, filter, open]);

  const selectedTool = toolName
    ? allTools.find((t) => t.serverId === serverId && t.name === toolName)
    : undefined;

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={filterText}
        onFocus={() => { setOpen(true); setFilter(displayValue); }}
        onChange={(e) => {
          const v = e.target.value;
          setFilter(v);
          if (!v) onChange('', '');
          if (!open) setOpen(true);
        }}
        placeholder="Search capabilities..."
        className="input font-mono text-sm w-full"
      />

      {/* Selected tool description */}
      {!open && selectedTool?.description && (
        <p className="text-[10px] text-text-tertiary mt-1 italic">{selectedTool.description}</p>
      )}

      {open && filtered.length > 0 && (
        <div className="absolute z-50 left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-md border border-surface-border bg-surface shadow-lg">
          {filtered.map((t) => (
            <button
              key={`${t.serverId}:${t.name}`}
              type="button"
              onClick={() => {
                onChange(t.serverId, t.name);
                setFilter(t.name);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 hover:bg-surface-hover transition-colors flex items-center gap-3 ${
                serverId === t.serverId && toolName === t.name ? 'bg-accent/5' : ''
              }`}
            >
              <span className="text-[11px] font-mono text-text-primary shrink-0">{t.name}</span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium shrink-0 bg-accent/10 text-accent">
                <Server className="w-2 h-2" strokeWidth={1.5} />
                {t.serverName}
              </span>
              {t.description && (
                <span className="text-[10px] text-text-quaternary truncate">{t.description}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {open && filtered.length === 0 && filter && (
        <div className="absolute z-50 left-0 right-0 mt-1 rounded-md border border-surface-border bg-surface shadow-lg px-3 py-4 text-center">
          <p className="text-[11px] text-text-quaternary">No capabilities match "{filter}"</p>
        </div>
      )}
    </div>
  );
}
