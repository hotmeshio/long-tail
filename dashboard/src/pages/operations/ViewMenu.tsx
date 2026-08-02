import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useAggregateByFacets } from '../../api/escalation-analytics';

/**
 * The board's view selector — the station view and every declared entity
 * system behind ONE compact menu (the sequence-menu pattern), never one
 * piece of chrome per system: a deployment declaring a dozen entity facets
 * gets a twelve-row list, not a twelve-chip strip.
 *
 * Each lens row carries its live distinct-entity count, fetched lazily only
 * while the menu is open (counts-only — the station-metrics data class, so
 * the rows render under the public board flag too).
 */
export function ViewMenu({ lenses, activeLens, stationCount, onSelect }: {
  lenses: string[];
  /** null = the station view. */
  activeLens: string | null;
  stationCount: number;
  onSelect: (lens: string | null) => void;
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

  const choose = (lens: string | null) => {
    onSelect(lens);
    setOpen(false);
  };

  return (
    <div
      ref={ref}
      className="relative"
      title="View: the board station-first, or an entity system (roles sharing an entity facet) entity-first"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex items-baseline gap-1.5"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Board view"
      >
        <span className="text-2xs uppercase tracking-widest text-text-quaternary">View</span>
        <span className="text-xs font-medium text-text-primary group-hover:text-accent transition-colors">
          {activeLens ? <>by <span className="font-mono">{activeLens}</span></> : 'Stations'}
        </span>
        <ChevronDown
          className={`w-3 h-3 self-center shrink-0 text-text-tertiary group-hover:text-accent transition-transform ${open ? 'rotate-180' : ''}`}
          strokeWidth={1.5}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute z-[100] top-full right-0 mt-1.5 min-w-[16rem] max-h-80 overflow-y-auto bg-surface-raised border border-surface-border rounded-md shadow-lg py-1"
        >
          <ViewOption
            label="Stations"
            note={`${stationCount} station${stationCount === 1 ? '' : 's'}`}
            active={activeLens === null}
            onClick={() => choose(null)}
          />
          {lenses.map((lens) => (
            <LensOption
              key={lens}
              lens={lens}
              active={activeLens === lens}
              fetchCount={open}
              onClick={() => choose(lens)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ViewOption({ label, note, active, onClick, mono }: {
  label: string;
  note: string | null;
  active: boolean;
  onClick: () => void;
  mono?: boolean;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 flex items-baseline gap-2.5 transition-colors ${
        active ? 'text-accent bg-accent/5' : 'text-text-primary hover:bg-surface-hover'
      }`}
    >
      <span className={`text-xs font-medium truncate ${mono ? 'font-mono' : ''}`}>{label}</span>
      {note && (
        <span className="ml-auto text-2xs font-mono text-text-quaternary tabular-nums shrink-0">{note}</span>
      )}
    </button>
  );
}

/** One lens row — its live distinct-entity count loads only while the menu is open. */
function LensOption({ lens, active, fetchCount, onClick }: {
  lens: string;
  active: boolean;
  fetchCount: boolean;
  onClick: () => void;
}) {
  const count = useAggregateByFacets(
    {
      query: { entity: lens },
      groupBy: {},
      measure: { kind: 'membership' },
      distinctBy: lens,
    },
    { enabled: fetchCount },
  );
  const n = count.data?.groups[0]?.count;
  return (
    <ViewOption
      label={`by ${lens}`}
      mono
      note={n != null ? `${n} in queue` : null}
      active={active}
      onClick={onClick}
    />
  );
}
