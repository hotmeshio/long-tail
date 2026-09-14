import { useMemo, useState } from 'react';
import { Ban } from 'lucide-react';
import { filterWorkflowIcons, workflowIconGlyph } from '../../../lib/workflow-icons';

/**
 * The curated icon grid with a filter above it: type part of a name or its
 * constant key to narrow the tiles. The current choice reads in accent; the
 * leading "none" tile returns to the tier glyph.
 */
export function WorkflowIconPicker({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  const [query, setQuery] = useState('');
  const names = useMemo(() => filterWorkflowIcons(query), [query]);
  const Chosen = workflowIconGlyph(value);

  return (
    <div className="space-y-2" data-testid="workflow-icon-picker">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter icons…"
          aria-label="Filter icons"
          className="input text-2xs py-1 w-40"
        />
        <span className="flex items-center gap-1.5 text-2xs text-text-tertiary min-w-0">
          {Chosen ? <Chosen className="w-3.5 h-3.5 text-accent shrink-0" strokeWidth={1.5} /> : <Ban className="w-3.5 h-3.5 shrink-0" strokeWidth={1.5} />}
          <span className="font-mono truncate">{value || 'tier glyph'}</span>
        </span>
      </div>
      <div className="flex flex-wrap gap-1" role="listbox" aria-label="Workflow icon">
        <button
          type="button"
          role="option"
          aria-selected={!value}
          title="No icon (tier glyph)"
          onClick={() => onChange('')}
          className={`p-1.5 rounded-md border transition-colors ${!value ? 'border-accent bg-accent/10 text-accent' : 'border-transparent text-text-quaternary hover:bg-surface-hover hover:text-text-secondary'}`}
        >
          <Ban className="w-4 h-4" strokeWidth={1.5} />
        </button>
        {names.map((name) => {
          const Glyph = workflowIconGlyph(name)!;
          const active = value === name;
          return (
            <button
              key={name}
              type="button"
              role="option"
              aria-selected={active}
              title={name}
              onClick={() => onChange(name)}
              className={`p-1.5 rounded-md border transition-colors ${active ? 'border-accent bg-accent/10 text-accent' : 'border-transparent text-text-tertiary hover:bg-surface-hover hover:text-text-primary'}`}
            >
              <Glyph className="w-4 h-4" strokeWidth={1.5} />
            </button>
          );
        })}
        {names.length === 0 && <p className="text-2xs text-text-tertiary px-1 py-1.5">No icon matches.</p>}
      </div>
    </div>
  );
}
