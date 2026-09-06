import { useEffect, useRef, useState } from 'react';
import { ChevronDown, TriangleAlert } from 'lucide-react';
import { useAggregateByFacets } from '../../api/escalation-analytics';

export interface FragmentOption {
  /** The segment's origin role id — its selection key. */
  origin: string;
  title: string;
  roleCount: number;
  pending: number;
  jeopardy: number;
}

/**
 * The one board selector: the Pace Board's role segments and the Trend Board's
 * by-facet lenses under a single menu, grouped by board. Selecting a segment
 * paces a set of roles; selecting a lens reads a metadata facet's trend. Lens
 * counts load lazily while the menu is open.
 */
export function ViewMenu({
  fragments,
  activeFragment,
  lenses,
  activeLens,
  onSelectFragment,
  onSelectLens,
}: {
  fragments: FragmentOption[];
  /** The active segment origin when on the Pace Board (activeLens === null). */
  activeFragment: string | null;
  lenses: string[];
  /** The active trend facet, or null when on the Pace Board. */
  activeLens: string | null;
  onSelectFragment: (origin: string) => void;
  onSelectLens: (lens: string) => void;
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

  const activeSegment = fragments.find((f) => f.origin === activeFragment) ?? fragments[0];
  const activeSegmentKey = activeLens ? null : activeSegment?.origin ?? null;

  return (
    <div ref={ref} className="relative" title="Board: pace a segment of roles, or read a metadata facet's trend">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex items-baseline gap-1.5"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Board view"
      >
        <span className="text-2xs uppercase tracking-widest text-text-quaternary">View</span>
        <span className="text-xs font-medium text-accent">
          {activeLens ? <>by <span className="font-mono">{activeLens}</span></> : (activeSegment?.title ?? 'Pace Board')}
        </span>
        <ChevronDown
          className={`w-3 h-3 self-center shrink-0 text-text-tertiary group-hover:text-accent transition-transform ${open ? 'rotate-180' : ''}`}
          strokeWidth={1.5}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute z-[100] top-full right-0 mt-1.5 min-w-[19rem] max-h-96 overflow-y-auto bg-surface-raised border border-surface-border rounded-md shadow-lg py-1"
        >
          <SectionLabel>Pace Board</SectionLabel>
          {fragments.map((f) => (
            <Row
              key={f.origin}
              label={f.title}
              note={`${f.roleCount} role${f.roleCount === 1 ? '' : 's'} · ${f.pending} pending`}
              jeopardy={f.jeopardy}
              active={f.origin === activeSegmentKey}
              onClick={() => { onSelectFragment(f.origin); setOpen(false); }}
            />
          ))}

          {lenses.length > 0 && (
            <>
              <SectionLabel>Trend Board</SectionLabel>
              {lenses.map((lens) => (
                <LensRow
                  key={lens}
                  lens={lens}
                  active={activeLens === lens}
                  fetchCount={open}
                  onClick={() => { onSelectLens(lens); setOpen(false); }}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pt-2 pb-1 text-2xs font-semibold uppercase tracking-widest text-text-quaternary first:pt-1">
      {children}
    </p>
  );
}

function Row({ label, note, jeopardy = 0, active, mono, onClick }: {
  label: string;
  note: string | null;
  jeopardy?: number;
  active: boolean;
  mono?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onClick}
      className={`w-full text-left pl-3 pr-2.5 py-1.5 flex items-baseline gap-2.5 border-l-2 transition-colors ${
        active
          ? 'border-accent bg-accent/10 text-accent'
          : 'border-transparent text-text-primary hover:bg-surface-hover'
      }`}
    >
      <span className={`text-xs font-medium truncate ${mono ? 'font-mono' : ''}`}>{label}</span>
      {note && (
        <span className={`ml-auto text-2xs font-mono tabular-nums shrink-0 ${active ? 'text-accent/70' : 'text-text-quaternary'}`}>{note}</span>
      )}
      {jeopardy > 0 && (
        <span className="flex items-center gap-0.5 text-2xs font-mono text-status-warning shrink-0" title={`${jeopardy} in jeopardy`}>
          <TriangleAlert className="w-3 h-3" strokeWidth={2} />{jeopardy}
        </span>
      )}
    </button>
  );
}

/** One trend row — its live distinct-entity count loads only while the menu is open. */
function LensRow({ lens, active, fetchCount, onClick }: {
  lens: string;
  active: boolean;
  fetchCount: boolean;
  onClick: () => void;
}) {
  const count = useAggregateByFacets(
    { query: { entity: lens }, groupBy: {}, measure: { kind: 'membership' }, distinctBy: lens },
    { enabled: fetchCount },
  );
  const n = count.data?.groups[0]?.count;
  return (
    <Row
      label={`by ${lens}`}
      mono
      note={n != null ? `${n} in queue` : null}
      active={active}
      onClick={onClick}
    />
  );
}
