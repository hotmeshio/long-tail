import { useState } from 'react';
import { CirclePause, Play } from 'lucide-react';
import { useControlPlaneApps, useThrottle } from '../../../api/controlplane';

export function EmergencyControls() {
  const { data: appsData } = useControlPlaneApps();
  const throttle = useThrottle();
  const [confirming, setConfirming] = useState(false);

  const apps = appsData?.apps ?? [];

  const applyAll = (ms: number) => {
    for (const app of apps) {
      throttle.mutate({ appId: app.appId, throttle: ms });
    }
    setConfirming(false);
  };

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-status-error">Pause all queues?</span>
        <button
          onClick={() => applyAll(-1)}
          className="px-2.5 py-1 text-xs rounded-md bg-status-error text-white hover:bg-status-error/90 transition-colors"
        >
          Confirm
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="px-2.5 py-1 text-xs text-text-tertiary hover:text-text-primary transition-colors"
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
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md text-status-error/80 hover:text-status-error hover:bg-status-error/10 transition-colors"
        title="Pause all queues"
      >
        <CirclePause className="w-3.5 h-3.5" />
        Pause All
      </button>
      <button
        onClick={() => applyAll(0)}
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md text-status-success/80 hover:text-status-success hover:bg-status-success/10 transition-colors"
        title="Resume all queues"
      >
        <Play className="w-3.5 h-3.5" />
        Resume All
      </button>
    </div>
  );
}
