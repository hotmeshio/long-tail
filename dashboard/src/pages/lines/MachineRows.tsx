import { useMemo, useState } from 'react';
import type { StripMachine } from './MachineStrip';
import { PRESENCE_DOT, PRESENCE_LABEL, presenceOf } from './wire-display';

const ROWS_BOX_CLASS = 'flex-1 min-h-0 overflow-y-auto border-t border-surface-border';

function matches(machine: StripMachine, needle: string): boolean {
  if (!needle) return true;
  const { summary, view } = machine;
  const hay = [summary.machineId, summary.process, summary.role, view?.address ?? summary.address ?? ''].join(' ').toLowerCase();
  return hay.includes(needle);
}

/**
 * One dense line per machine in line order, in a list that scrolls within
 * the region. The search narrows the declared list by id, process, role or address.
 */
export function MachineRows({
  machines,
  selectedId,
  onSelect,
}: {
  machines: StripMachine[];
  selectedId: string | null;
  onSelect: (machineId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const shown = useMemo(() => machines.filter((m) => matches(m, needle)), [machines, needle]);
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-3 pb-2 shrink-0">
        <label className="sr-only" htmlFor="machine-search">Find a machine</label>
        <input
          id="machine-search"
          type="search"
          className="input text-2xs font-mono py-1 w-full max-w-[16rem]"
          placeholder="id, process, role, address"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="text-2xs text-text-quaternary tabular-nums">{shown.length} of {machines.length}</span>
      </div>
      <ul className={ROWS_BOX_CLASS} aria-label="Machines">
        {shown.map(({ summary, view }) => {
          const presence = presenceOf(view);
          const selected = summary.machineId === selectedId;
          const address = view?.address ?? summary.address;
          const alarms = view?.alarms.length ?? 0;
          return (
            <li key={summary.machineId}>
              <button
                type="button"
                onClick={() => onSelect(summary.machineId)}
                aria-pressed={selected}
                data-presence={presence}
                className={`w-full text-left grid grid-cols-[auto_minmax(6rem,1fr)_minmax(0,2fr)_auto_auto_auto] items-baseline gap-x-3 px-2 py-1 border-l-2 border-b border-surface-border/60 hover:bg-surface-hover transition-colors ${
                  selected ? 'border-l-accent' : 'border-l-transparent'
                }`}
              >
                <span className={`w-2 h-2 rounded-full dot-ring self-center ${PRESENCE_DOT[presence]}`} title={PRESENCE_LABEL[presence]} />
                <span className="text-2xs font-mono text-text-primary truncate">{summary.machineId}</span>
                <span className="text-2xs font-mono text-text-tertiary truncate" title={address ?? undefined}>
                  {summary.process}
                  {address ? <span className="text-text-quaternary"> · {address}</span> : null}
                </span>
                <span className="text-2xs text-text-tertiary truncate max-w-[6rem]" title="Software">{view?.software ?? '—'}</span>
                <span className="text-2xs text-text-secondary tabular-nums whitespace-nowrap" title="Units held">held {view?.heldUnits.length ?? 0}</span>
                <span className="text-2xs font-mono text-text-tertiary tabular-nums whitespace-nowrap">
                  h {view?.rows.handoff ?? 0} c {view?.rows.command ?? 0} a {view?.rows.alarm ?? 0}
                  {alarms > 0 && <span className="text-status-warning ml-2" title="Active alarms">{alarms} alarm{alarms === 1 ? '' : 's'}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {shown.length === 0 && <p className="text-2xs text-text-tertiary py-2">No machine matches.</p>}
    </div>
  );
}
