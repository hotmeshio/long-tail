import { useState, useCallback } from 'react';
import { CirclePause, Play, Loader2 } from 'lucide-react';
import { useControlPlaneApps, useThrottle } from '../../../api/controlplane';

type Scope = 'engines' | 'workers' | 'all';

export function EmergencyControls() {
  const { data: appsData } = useControlPlaneApps();
  const throttle = useThrottle();
  const [confirming, setConfirming] = useState<{ ms: number; scope: Scope } | null>(null);
  const [inflight, setInflight] = useState(false);

  const apps = appsData?.apps ?? [];

  const applyAll = useCallback(async (ms: number, scope: Scope = 'all') => {
    if (apps.length === 0) return;
    setInflight(true);

    const results = await Promise.allSettled(
      apps.map((app) => throttle.mutateAsync({
        appId: app.appId,
        throttle: ms,
        ...(scope !== 'all' ? { scope } : {}),
      })),
    );

    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      console.error(`Emergency throttle: ${failed}/${results.length} apps failed`);
    }

    setInflight(false);
    setConfirming(null);
  }, [apps, throttle]);

  const scopeLabel = (scope: Scope) =>
    scope === 'engines' ? 'engines' : scope === 'workers' ? 'workers' : 'everything';

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-status-error">
          Pause {scopeLabel(confirming.scope)}?
        </span>
        <button
          onClick={() => applyAll(confirming.ms, confirming.scope)}
          disabled={inflight}
          className="px-2.5 py-1 text-xs rounded-md bg-status-error text-white hover:bg-status-error/90 transition-colors disabled:opacity-50"
        >
          {inflight ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Confirm'}
        </button>
        <button
          onClick={() => setConfirming(null)}
          disabled={inflight}
          className="px-2.5 py-1 text-xs text-text-tertiary hover:text-text-primary transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => setConfirming({ ms: -1, scope: 'all' })}
        disabled={inflight}
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md text-status-error/80 hover:text-status-error hover:bg-status-error/10 transition-colors disabled:opacity-50"
        title="Pause all engines and workers"
      >
        <CirclePause className="w-3.5 h-3.5" />
        Pause All
      </button>
      <button
        onClick={() => applyAll(0)}
        disabled={inflight}
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md text-status-success/80 hover:text-status-success hover:bg-status-success/10 transition-colors disabled:opacity-50"
        title="Resume all engines and workers"
      >
        {inflight ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
        Resume All
      </button>
    </div>
  );
}
