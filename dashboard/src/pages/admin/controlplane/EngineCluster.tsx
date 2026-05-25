import { useMemo, useState } from 'react';
import { Zap, Server, CirclePause, ChevronRight, Gauge } from 'lucide-react';
import { Collapsible } from '../../../components/common/layout/Collapsible';
import type { QuorumProfile } from '../../../api/controlplane';
import { sumCounts, formatUptime, engineLabel, engineSource, formatMemory, isThrottled, formatThrottleHuman } from './helpers';

interface EngineClusterProps {
  engines: QuorumProfile[];
  onThrottle: (profile: QuorumProfile) => void;
  onResumeThrottle: (profile: QuorumProfile) => void;
  isLoading: boolean;
}

/** Identify the active engine: the non-paused engine with the most processed messages. */
function findActive(engines: QuorumProfile[]): QuorumProfile | null {
  if (engines.length === 0) return null;
  // Only consider engines that aren't paused/throttled
  const candidates = engines.filter((e) => !isThrottled(e));
  // If all are paused, there is no active engine
  if (candidates.length === 0) return null;
  let active: QuorumProfile | null = null;
  let maxCount = -1;
  for (const e of candidates) {
    const total = sumCounts([e]).total;
    if (total > maxCount) {
      maxCount = total;
      active = e;
    }
  }
  return active || candidates[0];
}

function Stat({ value, label, warn, title }: { value: string | number; label: string; warn?: boolean; title?: string }) {
  return (
    <div title={title}>
      <p className={`text-sm font-mono tabular-nums ${warn ? 'text-status-warning' : 'text-text-primary'}`}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
      <p className="text-[9px] text-text-tertiary uppercase tracking-widest">{label}</p>
    </div>
  );
}

function StandbyRow({ engine }: { engine: QuorumProfile }) {
  const label = engineLabel(engine.engine_id);
  const source = engineSource(engine.engine_id);
  const paused = isThrottled(engine);

  return (
    <div className="flex items-center gap-3 py-1.5">
      <Server className="w-3 h-3 text-text-tertiary/40 shrink-0" strokeWidth={1.5} />
      <span className="text-xs text-text-secondary truncate max-w-[180px]" title={engine.engine_id}>{label}</span>
      {source && <span className="text-[10px] text-text-tertiary/50">{source}</span>}
      <span className="flex-1" />
      {paused && (
        <span className="text-[10px] text-status-warning">{engine.throttle === -1 ? 'Paused' : formatThrottleHuman(engine.throttle)}</span>
      )}
      <span className="text-[10px] font-mono text-text-tertiary/50">{formatUptime(engine.inited)}</span>
    </div>
  );
}

export function EngineCluster({ engines, onThrottle, isLoading }: EngineClusterProps) {
  const [showStandby, setShowStandby] = useState(false);

  const active = useMemo(() => findActive(engines), [engines]);
  const rest = useMemo(
    () => engines.filter((e) => e !== active).sort((a, b) => {
      // Paused engines first in the standby list (they're notable)
      const ap = isThrottled(a) ? 0 : 1;
      const bp = isThrottled(b) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return engineLabel(a.engine_id).localeCompare(engineLabel(b.engine_id));
    }),
    [engines, active],
  );

  const pausedCount = engines.filter(isThrottled).length;

  if (isLoading) {
    return <p className="text-xs text-text-tertiary">Discovering engines...</p>;
  }

  if (engines.length === 0) {
    return <p className="text-xs text-text-tertiary">No engines found.</p>;
  }

  // All engines paused — no active processor
  if (!active) {
    return (
      <div>
        <div className="flex items-center gap-3 py-2">
          <CirclePause className="w-4 h-4 text-status-error shrink-0" strokeWidth={1.5} />
          <span className="text-base text-status-error font-medium">All {engines.length} engines paused</span>
          <span className="text-[10px] text-text-tertiary">Messages are accumulating. Resume at least one engine to restore processing.</span>
        </div>
        <div className="mt-2">
          {engines.map((e) => (
            <StandbyRow key={e.engine_id} engine={e} />
          ))}
        </div>
      </div>
    );
  }

  const label = engineLabel(active.engine_id);
  const source = engineSource(active.engine_id);
  const counts = sumCounts([active]);
  const pending = active.stream_depth ?? 0;

  return (
    <div>
      {/* Active engine */}
      <div className="flex items-center gap-3 py-2">
        <Zap className="w-4 h-4 text-status-success shrink-0" strokeWidth={1.5} />
        <span className="text-base text-text-primary font-medium">{label}</span>
        {source && <span className="text-[10px] text-text-tertiary/60">{source}</span>}
        <span className="text-[9px] text-status-success uppercase tracking-widest">active</span>
        <span className="flex-1" />

        <button
          onClick={() => onThrottle(active)}
          className="flex items-center gap-1 text-[10px] text-text-tertiary hover:text-status-warning transition-colors"
          title="Pause to force failover to standby"
        >
          <CirclePause className="w-3.5 h-3.5" />
          Pause
        </button>
        <button
          onClick={() => onThrottle(active)}
          className="text-text-tertiary hover:text-accent transition-colors"
          title="Adjust throttle"
        >
          <Gauge className="w-3.5 h-3.5" strokeWidth={1.5} />
        </button>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-8 ml-7 mt-1">
        <Stat value={counts.total} label="processed" />
        <Stat value={pending} label="queued" warn={pending > 100} title="Total messages waiting in the engine stream (shared across all engines)" />
        {counts.errors > 0 && <Stat value={counts.errors} label="errors" warn />}
        <Stat value={formatUptime(active.inited)} label="uptime" />
        <Stat value={formatMemory(active.system?.TotalMemoryGB, active.system?.FreeMemoryGB)} label="memory" />
      </div>

      {/* Standby / paused list */}
      {rest.length > 0 && (
        <div className="mt-4 ml-7">
          <button
            onClick={() => setShowStandby(!showStandby)}
            className="flex items-center gap-1.5 text-[10px] text-text-tertiary hover:text-text-secondary transition-colors"
          >
            <ChevronRight className={`w-3 h-3 transition-transform duration-200 ${showStandby ? 'rotate-90' : ''}`} strokeWidth={2} />
            {rest.length} standby{pausedCount > 0 ? ` (${pausedCount} paused)` : ''}
          </button>
          <Collapsible open={showStandby}>
            <div className="mt-1">
              {rest.map((e) => (
                <StandbyRow key={e.engine_id} engine={e} />
              ))}
            </div>
          </Collapsible>
        </div>
      )}
    </div>
  );
}
