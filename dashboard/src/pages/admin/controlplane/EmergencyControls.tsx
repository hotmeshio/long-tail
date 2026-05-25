import { useState, useCallback } from 'react';
import { CirclePause, Play, Loader2 } from 'lucide-react';
import { useControlPlaneApps, useThrottle } from '../../../api/controlplane';

export function EmergencyControls() {
  const { data: appsData } = useControlPlaneApps();
  const throttle = useThrottle();
  const [confirming, setConfirming] = useState(false);
  const [inflight, setInflight] = useState(false);

  const apps = appsData?.apps ?? [];

  const applyAll = useCallback(async (ms: number) => {
    if (apps.length === 0) return;
    setInflight(true);

    // Use mutateAsync so each call returns a real promise.
    // Promise.allSettled ensures all apps get throttled even if some fail.
    const results = await Promise.allSettled(
      apps.map((app) => throttle.mutateAsync({ appId: app.appId, throttle: ms })),
    );

    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      console.error(`Emergency throttle: ${failed}/${results.length} apps failed`);
    }

    setInflight(false);
    setConfirming(false);
  }, [apps, throttle]);

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-status-error">
          Pause all {apps.length} app{apps.length !== 1 ? 's' : ''}?
        </span>
        <button
          onClick={() => applyAll(-1)}
          disabled={inflight}
          className="px-2.5 py-1 text-xs rounded-md bg-status-error text-white hover:bg-status-error/90 transition-colors disabled:opacity-50"
        >
          {inflight ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Confirm'}
        </button>
        <button
          onClick={() => setConfirming(false)}
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
        onClick={() => setConfirming(true)}
        disabled={inflight}
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md text-status-error/80 hover:text-status-error hover:bg-status-error/10 transition-colors disabled:opacity-50"
        title="Pause all queues across all applications"
      >
        <CirclePause className="w-3.5 h-3.5" />
        Pause All
      </button>
      <button
        onClick={() => applyAll(0)}
        disabled={inflight}
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md text-status-success/80 hover:text-status-success hover:bg-status-success/10 transition-colors disabled:opacity-50"
        title="Resume all queues across all applications"
      >
        {inflight ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
        Resume All
      </button>
    </div>
  );
}
