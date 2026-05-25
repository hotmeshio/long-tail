import { useMemo, useState } from 'react';
import { Zap, CirclePause, ChevronRight, Gauge } from 'lucide-react';
import { Collapsible } from '../../../components/common/layout/Collapsible';
import type { QuorumProfile } from '../../../api/controlplane';
import { sumCounts, formatUptime, engineLabel, engineSource, isThrottled, formatThrottleHuman } from './helpers';

interface EngineClusterProps {
  engines: QuorumProfile[];
  onThrottle: (profile: QuorumProfile) => void;
  isLoading: boolean;
}

function categorize(engines: QuorumProfile[]) {
  const active: QuorumProfile[] = [];
  const idle: QuorumProfile[] = [];
  const paused: QuorumProfile[] = [];

  for (const e of engines) {
    if (isThrottled(e)) {
      paused.push(e);
    } else if (e.is_scout || sumCounts([e]).total > 0) {
      active.push(e);
    } else {
      idle.push(e);
    }
  }

  // Sort active by processed descending; scout first if tied
  active.sort((a, b) => {
    if (a.is_scout && !b.is_scout) return -1;
    if (!a.is_scout && b.is_scout) return 1;
    return sumCounts([b]).total - sumCounts([a]).total;
  });

  idle.sort((a, b) => engineLabel(a.engine_id).localeCompare(engineLabel(b.engine_id)));
  paused.sort((a, b) => engineLabel(a.engine_id).localeCompare(engineLabel(b.engine_id)));

  return { active, idle, paused };
}

function EngineRow({ engine, isFirst, onThrottle }: {
  engine: QuorumProfile;
  isFirst?: boolean;
  onThrottle: (p: QuorumProfile) => void;
}) {
  const label = engineLabel(engine.engine_id);
  const source = engineSource(engine.engine_id);
  const counts = sumCounts([engine]);
  const pending = engine.stream_depth ?? 0;
  const paused = isThrottled(engine);

  return (
    <div className="group/row flex items-center gap-3 py-2 hover:bg-surface-hover/50 transition-colors rounded px-1">
      {paused ? (
        <CirclePause className="w-3.5 h-3.5 text-status-warning shrink-0" strokeWidth={1.5} />
      ) : (
        <Zap className={`w-3.5 h-3.5 shrink-0 ${counts.total > 0 || engine.is_scout ? 'text-status-success' : 'text-text-tertiary/30'}`} strokeWidth={1.5} />
      )}

      <span className={`${isFirst ? 'text-base font-medium' : 'text-xs'} text-text-primary truncate max-w-[180px]`} title={engine.engine_id}>
        {label}
      </span>
      {source && <span className="text-[10px] text-text-tertiary/50">{source}</span>}

      {engine.is_scout && (
        <span className="text-[9px] text-amber-500 uppercase tracking-widest">scout</span>
      )}

      <span className="flex-1" />

      {paused && (
        <span className="text-[10px] text-status-warning">{engine.throttle === -1 ? 'Paused' : formatThrottleHuman(engine.throttle)}</span>
      )}

      {counts.total > 0 && (
        <span className="text-[10px] font-mono tabular-nums text-text-tertiary w-16 text-right">{counts.total.toLocaleString()}</span>
      )}

      {pending > 0 && (
        <span className={`text-[10px] font-mono tabular-nums w-14 text-right ${pending > 100 ? 'text-status-warning' : 'text-text-tertiary/50'}`}>{pending.toLocaleString()} q</span>
      )}

      <span className="text-[10px] font-mono text-text-tertiary/40 w-12 text-right">{formatUptime(engine.inited)}</span>

      <span className="opacity-0 group-hover/row:opacity-100 transition-opacity">
        <button
          onClick={(e) => { e.stopPropagation(); onThrottle(engine); }}
          className="text-text-tertiary hover:text-accent transition-colors"
          title={paused ? 'Resume / adjust throttle' : 'Pause / throttle'}
        >
          <Gauge className="w-3.5 h-3.5" strokeWidth={1.5} />
        </button>
      </span>
    </div>
  );
}

function CollapsibleGroup({ label, engines, onThrottle }: {
  label: string;
  engines: QuorumProfile[];
  onThrottle: (p: QuorumProfile) => void;
}) {
  const [open, setOpen] = useState(false);
  if (engines.length === 0) return null;

  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[10px] text-text-tertiary hover:text-text-secondary transition-colors py-1"
      >
        <ChevronRight className={`w-3 h-3 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} strokeWidth={2} />
        {engines.length} {label}
      </button>
      <Collapsible open={open}>
        <div className="ml-1">
          {engines.map((e) => (
            <EngineRow key={e.engine_id} engine={e} onThrottle={onThrottle} />
          ))}
        </div>
      </Collapsible>
    </div>
  );
}

export function EngineCluster({ engines, onThrottle, isLoading }: EngineClusterProps) {
  const { active, idle, paused } = useMemo(() => categorize(engines), [engines]);

  if (isLoading) {
    return <p className="text-xs text-text-tertiary">Discovering engines...</p>;
  }

  if (engines.length === 0) {
    return <p className="text-xs text-text-tertiary">No engines found.</p>;
  }

  // All paused — no active processor
  if (active.length === 0 && idle.length === 0) {
    return (
      <div>
        <div className="flex items-center gap-3 py-2">
          <CirclePause className="w-4 h-4 text-status-error shrink-0" strokeWidth={1.5} />
          <span className="text-base text-status-error font-medium">All {engines.length} engines paused</span>
        </div>
        <p className="text-[10px] text-text-tertiary ml-7">Messages are accumulating. Resume at least one engine to restore processing.</p>
        <div className="ml-1 mt-2">
          {paused.map((e) => (
            <EngineRow key={e.engine_id} engine={e} onThrottle={onThrottle} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Active engines — shown individually */}
      {active.map((e, i) => (
        <EngineRow key={e.engine_id} engine={e} isFirst={i === 0} onThrottle={onThrottle} />
      ))}

      {/* Idle — collapsed */}
      <CollapsibleGroup label="idle" engines={idle} onThrottle={onThrottle} />

      {/* Paused — collapsed */}
      <CollapsibleGroup label="paused" engines={paused} onThrottle={onThrottle} />
    </div>
  );
}
