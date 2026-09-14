import { useEffect, useState } from 'react';
import { ScanBarcode, X } from 'lucide-react';
import { useScanInput } from '../../hooks/useScanInput';
import { useShellPanel } from '../../hooks/useShellPanel';
import { SCAN_SOURCE_IDS } from '../../lib/scan-sources/types';
import { ScanOutcomeBody } from './ScanOutcomeBody';

const DISMISS_MS = 6_000;
const SCAN_PANEL_KEY = 'scan';

/**
 * Transient scan-outcome notice. Scans that answer with navigation get their
 * feedback from the page they land on; every other outcome — a no-match
 * fallback, a resolve that closed the row in place, a rejected code — needs
 * a voice when the scan panel is closed. This toast is it: bottom-right,
 * token-styled, self-dismissing.
 */
export function ScanToast() {
  const { lastResult } = useScanInput();
  const { open: panelOpen, ownerKey } = useShellPanel();
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  // Auto-dismiss keyed to the result's timestamp — a new scan restarts the clock.
  useEffect(() => {
    if (!lastResult) return;
    const timer = setTimeout(() => setDismissedAt(lastResult.at), DISMISS_MS);
    return () => clearTimeout(timer);
  }, [lastResult]);

  if (!lastResult || lastResult.navigated) return null;
  if (dismissedAt === lastResult.at) return null;
  // The open scan panel and the header bar each narrate their own outcomes.
  if (panelOpen && ownerKey === SCAN_PANEL_KEY) return null;
  if (lastResult.source === SCAN_SOURCE_IDS.TOOLBAR) return null;

  return (
    <div
      role="status"
      className="fixed bottom-14 right-4 z-[60] w-80 max-w-[calc(100vw-2rem)] bg-surface-raised border border-surface-border shadow-lg rounded-md animate-page-in"
    >
      <div className="flex items-start gap-2.5 px-3.5 py-3">
        <ScanBarcode className="w-4 h-4 mt-0.5 text-accent-muted shrink-0" strokeWidth={1.5} />
        <div className="flex-1 min-w-0">
          <ScanOutcomeBody result={lastResult} />
        </div>
        <button
          type="button"
          onClick={() => setDismissedAt(lastResult.at)}
          className="text-text-tertiary hover:text-text-primary shrink-0"
          title="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
