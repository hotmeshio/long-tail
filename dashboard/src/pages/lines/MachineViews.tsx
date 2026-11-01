import { useMemo } from 'react';
import { LayoutGrid, List } from 'lucide-react';
import { MACHINE_VIEWS, MACHINE_VIEW_LABEL, needsAttention, type MachineViewMode } from './line-view-prefs';
import { MachineRows } from './MachineRows';
import { MachineStrip, type StripMachine } from './MachineStrip';

const VIEW_ICON: Record<MachineViewMode, typeof LayoutGrid> = { tiles: LayoutGrid, rows: List };
const RADIO_CLASS = 'p-1 transition-colors';
const RADIO_ON = 'text-text-primary bg-surface-sunken';
const RADIO_OFF = 'text-text-tertiary hover:text-text-primary';

export interface MachineViewsProps {
  machines: StripMachine[];
  selectedId: string | null;
  onSelect: (machineId: string) => void;
  view: MachineViewMode;
  onView: (view: MachineViewMode) => void;
  attentionOnly: boolean;
  onAttentionOnly: (on: boolean) => void;
}

/**
 * The machines region: the count, a needs-attention filter and the view
 * radios on the right (tiles or rows), with the chosen view filling the
 * region beneath. The region is bounded, so the wire below never moves.
 */
export function MachineViews(props: MachineViewsProps) {
  const { machines, selectedId, onSelect, view, onView, attentionOnly, onAttentionOnly } = props;
  const shown = useMemo(
    () => (attentionOnly ? machines.filter((m) => needsAttention(m.view)) : machines),
    [machines, attentionOnly],
  );
  const attention = useMemo(() => machines.filter((m) => needsAttention(m.view)).length, [machines]);
  if (machines.length === 0) {
    return <p className="text-2xs text-text-tertiary">The line declares no machines.</p>;
  }
  const View = view === 'rows' ? MachineRows : MachineStrip;
  return (
    <section aria-label="Machines region" data-view={view} className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-3 pb-2 shrink-0">
        <span className="text-2xs text-text-quaternary tabular-nums">
          {machines.length} machine{machines.length === 1 ? '' : 's'}
          {attention > 0 && <span className="text-status-warning"> · {attention} need{attention === 1 ? 's' : ''} attention</span>}
        </span>
        <span className="ml-auto flex items-center gap-3">
          <button
            type="button"
            aria-pressed={attentionOnly}
            onClick={() => onAttentionOnly(!attentionOnly)}
            className={`px-2 py-0.5 text-2xs rounded border transition-colors ${
              attentionOnly ? 'border-status-warning text-status-warning' : 'border-surface-border text-text-secondary hover:text-text-primary'
            }`}
          >
            Needs attention
          </button>
          <span className="inline-flex rounded border border-surface-border overflow-hidden" role="radiogroup" aria-label="Machines view">
            {MACHINE_VIEWS.map((mode) => {
              const Icon = VIEW_ICON[mode];
              return (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={view === mode}
                  aria-label={MACHINE_VIEW_LABEL[mode]}
                  title={MACHINE_VIEW_LABEL[mode]}
                  onClick={() => onView(mode)}
                  className={`${RADIO_CLASS} ${view === mode ? RADIO_ON : RADIO_OFF}`}
                >
                  <Icon className="w-3.5 h-3.5" />
                </button>
              );
            })}
          </span>
        </span>
      </div>
      {shown.length === 0 ? (
        <p className="text-2xs text-text-tertiary py-1">Every machine is quiet.</p>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <View machines={shown} selectedId={selectedId} onSelect={onSelect} />
        </div>
      )}
    </section>
  );
}
