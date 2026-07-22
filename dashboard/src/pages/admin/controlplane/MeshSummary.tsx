import { Shield, ShieldAlert, ShieldOff, Server, Users, Layers, Zap, AlertTriangle, Inbox } from 'lucide-react';

interface MeshSummaryProps {
  health: 'healthy' | 'degraded' | 'paused' | 'unknown';
  engineCount: number;
  workerCount: number;
  queueCount: number;
  totalProcessed: number;
  totalPending: number;
  totalErrors: number;
}

const HEALTH_CONFIG = {
  healthy: {
    icon: Shield,
    label: 'Healthy',
    color: 'text-status-success',
    desc: 'All engines and workers are processing normally.',
  },
  degraded: {
    icon: ShieldAlert,
    label: 'Degraded',
    color: 'text-status-warning',
    desc: 'Some nodes are throttled or reporting errors.',
  },
  paused: {
    icon: ShieldOff,
    label: 'Paused',
    color: 'text-status-error',
    desc: 'One or more queues are paused. Messages are accumulating.',
  },
  unknown: {
    icon: Shield,
    label: 'Discovering...',
    color: 'text-text-tertiary',
    desc: 'Waiting for roll call responses.',
  },
};

function StatCard({ icon: Icon, label, value, muted }: {
  icon: typeof Server;
  label: string;
  value: string | number;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className={`w-3.5 h-3.5 shrink-0 ${muted ? 'text-text-tertiary/40' : 'text-text-tertiary'}`} strokeWidth={1.5} />
      <div>
        <p className={`text-sm font-mono tabular-nums ${muted ? 'text-text-tertiary/60' : 'text-text-primary'}`}>
          {typeof value === 'number' ? value.toLocaleString() : value}
        </p>
        <p className="text-2xs text-text-tertiary uppercase tracking-widest">{label}</p>
      </div>
    </div>
  );
}

export function MeshSummary({
  health,
  engineCount,
  workerCount,
  queueCount,
  totalProcessed,
  totalPending,
  totalErrors,
}: MeshSummaryProps) {
  const cfg = HEALTH_CONFIG[health];
  const HealthIcon = cfg.icon;

  return (
    <div className="py-4 border-b border-surface-border/60">
      <div className="flex items-start gap-4">
        {/* Health status */}
        <div className="flex items-center gap-2 min-w-[140px]">
          <HealthIcon className={`w-5 h-5 ${cfg.color}`} strokeWidth={1.5} />
          <div>
            <p className={`text-sm font-semibold ${cfg.color}`}>{cfg.label}</p>
            <p className="text-2xs text-text-tertiary max-w-[200px]">{cfg.desc}</p>
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-6 ml-auto">
          <StatCard icon={Server} label="Engines" value={engineCount} muted={engineCount === 0} />
          <StatCard icon={Users} label="Workers" value={workerCount} muted={workerCount === 0} />
          <StatCard icon={Layers} label="Queues" value={queueCount} muted={queueCount === 0} />
          <StatCard icon={Zap} label="Processed" value={totalProcessed} muted={totalProcessed === 0} />
          {totalPending > 0 && (
            <StatCard icon={Inbox} label="Pending" value={totalPending} />
          )}
          {totalErrors > 0 && (
            <StatCard icon={AlertTriangle} label="Errors" value={totalErrors} />
          )}
        </div>
      </div>

      {/* Connection sharing note */}
      {engineCount > 1 && (
        <p className="text-2xs text-text-tertiary mt-3 ml-7">
          All {engineCount} engines share a pooled database connection. Workload distribution is handled by Postgres
          row-level locking (SKIP LOCKED) — each engine dequeues independently from the same stream.
        </p>
      )}
    </div>
  );
}
