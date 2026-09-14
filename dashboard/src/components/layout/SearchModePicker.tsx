import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ScanBarcode } from 'lucide-react';
import {
  SEARCH_MODE_KINDS,
  commandPrefix,
  modeLabel,
  type ScanCommand,
  type SearchMode,
} from '../../lib/search-command';

const FACET_NOTES: Record<string, string> = {
  escalationId: 'opens the item',
  workflowId: 'opens the run',
};

/**
 * The trailing type chip on the header bar and its menu: Find modes (the
 * configured search facets) and Run modes (every enabled scan rule, grouped by
 * scheme). The chip sizes to its label so a short facet leaves no gap.
 */
export function SearchModePicker({
  mode,
  facets,
  commands,
  onSelect,
  onOpenScanPanel,
}: {
  mode: SearchMode;
  facets: readonly string[];
  commands: readonly ScanCommand[];
  onSelect: (mode: SearchMode) => void;
  onOpenScanPanel?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const isCommand = mode.kind === SEARCH_MODE_KINDS.COMMAND;
  const title = isCommand
    ? `${mode.command.schemeName} · ${mode.command.name} — ${commandPrefix(mode.command)}<${mode.command.targetFacet}>`
    : `Search by ${mode.facet}`;
  const schemes = groupByScheme(commands);

  const pick = (next: SearchMode) => {
    onSelect(next);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative h-full shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Search or run as"
        title={title}
        className="group flex items-center gap-1 h-full pl-2.5 pr-2 border-l border-surface-field-border hover:bg-surface-hover transition-colors rounded-r-[var(--lt-radius-field)]"
        data-testid="search-mode"
      >
        <span
          className={`text-2xs whitespace-nowrap truncate max-w-[9rem] ${
            isCommand ? 'font-medium text-accent' : 'font-mono text-text-tertiary'
          }`}
        >
          {modeLabel(mode)}
        </span>
        <ChevronDown
          className={`w-3 h-3 shrink-0 text-text-quaternary group-hover:text-accent transition-transform ${open ? 'rotate-180' : ''}`}
          strokeWidth={1.5}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Search or run as"
          className="absolute z-50 top-full right-0 mt-1.5 min-w-[17rem] max-w-[24rem] max-h-[70vh] overflow-y-auto bg-surface-raised border border-surface-border rounded-md shadow-lg py-1"
        >
          {facets.length > 0 && (
            <>
              <SectionLabel>Find</SectionLabel>
              {facets.map((facet) => (
                <Row
                  key={facet}
                  label={facet}
                  mono
                  note={FACET_NOTES[facet] ?? 'filters the list'}
                  active={!isCommand && mode.facet === facet}
                  onClick={() => pick({ kind: SEARCH_MODE_KINDS.FACET, facet })}
                />
              ))}
            </>
          )}

          {schemes.map(({ schemeName, targetFacet, items }) => (
            <div key={schemeName}>
              <SectionLabel note={targetFacet}>Run · {schemeName}</SectionLabel>
              {items.map((command) => (
                <Row
                  key={`${command.version}:${command.category}`}
                  label={command.name}
                  note={commandPrefix(command)}
                  noteMono
                  active={isCommand && mode.command.version === command.version && mode.command.category === command.category}
                  onClick={() => pick({ kind: SEARCH_MODE_KINDS.COMMAND, command })}
                />
              ))}
            </div>
          ))}

          {onOpenScanPanel && (
            <>
              <hr className="border-surface-border/60 my-1" />
              <button
                type="button"
                onClick={() => { setOpen(false); onOpenScanPanel(); }}
                className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-xs text-accent hover:bg-surface-hover"
                data-testid="search-mode-scan-panel"
              >
                <ScanBarcode className="w-3.5 h-3.5 shrink-0" strokeWidth={1.5} />
                Scanner settings and barcode preview
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function groupByScheme(commands: readonly ScanCommand[]) {
  const groups: { schemeName: string; targetFacet: string; items: ScanCommand[] }[] = [];
  for (const c of commands) {
    const group = groups.find((g) => g.schemeName === c.schemeName);
    if (group) group.items.push(c);
    else groups.push({ schemeName: c.schemeName, targetFacet: c.targetFacet, items: [c] });
  }
  return groups;
}

function SectionLabel({ children, note }: { children: ReactNode; note?: string }) {
  return (
    <p className="px-3 pt-2 pb-1 flex items-baseline gap-2 text-2xs font-semibold uppercase tracking-widest text-text-quaternary first:pt-1">
      <span className="truncate">{children}</span>
      {note && <span className="ml-auto font-mono font-normal normal-case tracking-normal shrink-0">{note}</span>}
    </p>
  );
}

function Row({ label, note, active, mono, noteMono, onClick }: {
  label: string;
  note: string;
  active: boolean;
  mono?: boolean;
  noteMono?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onClick}
      className={`w-full text-left pl-3 pr-3 py-1.5 flex items-baseline gap-3 border-l-2 transition-colors ${
        active
          ? 'border-accent bg-accent/10 text-accent'
          : 'border-transparent text-text-primary hover:bg-surface-hover'
      }`}
    >
      <span className={`text-xs font-medium truncate ${mono ? 'font-mono' : ''}`}>{label}</span>
      <span className={`ml-auto text-2xs shrink-0 ${noteMono ? 'font-mono tabular-nums' : ''} ${active ? 'text-accent/70' : 'text-text-quaternary'}`}>
        {note}
      </span>
    </button>
  );
}
