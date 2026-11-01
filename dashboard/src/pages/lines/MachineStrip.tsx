import type { LineSummaryMachine, MachineView } from '../../api/machines';
import { PRESENCE_DOT, PRESENCE_LABEL, presenceOf } from './wire-display';

export interface StripMachine {
  summary: LineSummaryMachine;
  /** Absent while the replica stands by or before the leader has heard the machine. */
  view: MachineView | undefined;
}

/**
 * One tile per machine in line order: presence ring, identity in mono, the
 * software it runs, what it holds, and its open rows by kind. Click selects.
 * Tiles fill the width in as many columns as fit.
 */
export function MachineStrip({
  machines,
  selectedId,
  onSelect,
}: {
  machines: StripMachine[];
  selectedId: string | null;
  onSelect: (machineId: string) => void;
}) {
  if (machines.length === 0) {
    return <p className="text-2xs text-text-tertiary">The line declares no machines.</p>;
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-y-3" role="list" aria-label="Machines">
      {machines.map(({ summary, view }) => {
        const presence = presenceOf(view);
        const selected = summary.machineId === selectedId;
        const address = view?.address ?? summary.address;
        const alarms = view?.alarms.length ?? 0;
        return (
          <button
            key={summary.machineId}
            type="button"
            role="listitem"
            onClick={() => onSelect(summary.machineId)}
            aria-pressed={selected}
            data-presence={presence}
            className={`text-left min-w-0 pl-3 pr-4 py-1.5 border-l-2 transition-colors hover:bg-surface-hover ${
              selected ? 'border-accent' : 'border-surface-border'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`w-2.5 h-2.5 rounded-full dot-ring shrink-0 ${PRESENCE_DOT[presence]}`}
                title={PRESENCE_LABEL[presence]}
              />
              <span className="text-xs font-mono text-text-primary truncate">{summary.machineId}</span>
              <span className="text-2xs text-text-quaternary ml-auto shrink-0">{PRESENCE_LABEL[presence]}</span>
            </div>
            <div className="text-2xs font-mono text-text-tertiary truncate mt-0.5" title={address ?? undefined}>
              {summary.process}
              {address ? <span className="text-text-quaternary"> · {address}</span> : null}
            </div>
            <div className="flex items-center gap-3 text-2xs mt-1 tabular-nums">
              <span className="text-text-tertiary truncate" title="Software">{view?.software ?? '—'}</span>
              <span className="text-text-secondary shrink-0" title="Units held">
                held {view?.heldUnits.length ?? 0}
              </span>
            </div>
            <div className="flex items-center gap-3 text-2xs font-mono mt-0.5 tabular-nums">
              <span className="text-text-tertiary" title="Open handoff rows">h {view?.rows.handoff ?? 0}</span>
              <span className="text-text-tertiary" title="Open command rows">c {view?.rows.command ?? 0}</span>
              <span className="text-text-tertiary" title="Open alarm rows">a {view?.rows.alarm ?? 0}</span>
              {alarms > 0 && (
                <span className="text-status-warning ml-auto" title="Active alarms">
                  {alarms} alarm{alarms === 1 ? '' : 's'}
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
