import { useEffect, useState } from 'react';
import { ScanBarcode, X } from 'lucide-react';
import { useScanInput } from '../../hooks/useScanInput';
import { useShellPanel } from '../../hooks/useShellPanel';
import { OUTCOME_TONE, outcomeHeadline, outcomeMarkdown } from './outcome-display';
import { SimpleMarkdown } from '../common/display/SimpleMarkdown';

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
  // The open scan panel already narrates the outcome.
  if (panelOpen && ownerKey === SCAN_PANEL_KEY) return null;

  const { response } = lastResult;

  return (
    <div
      role="status"
      className="fixed bottom-14 right-4 z-[60] w-80 max-w-[calc(100vw-2rem)] bg-surface-raised border border-surface-border shadow-lg rounded-md animate-page-in"
    >
      <div className="flex items-start gap-2.5 px-3.5 py-3">
        <ScanBarcode className="w-4 h-4 mt-0.5 text-accent-muted shrink-0" strokeWidth={1.5} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-mono text-text-secondary truncate">{lastResult.code}</div>
          {response ? (
            <>
              <div className={`text-sm font-medium ${OUTCOME_TONE[response.outcome]}`}>
                {outcomeHeadline(response)}
              </div>
              {response.error && (
                <div className="text-xs text-text-tertiary mt-0.5">{response.error}</div>
              )}
              {outcomeMarkdown(response) && (
                <div className="text-xs text-text-secondary mt-1.5">
                  <SimpleMarkdown content={outcomeMarkdown(response)!} compact />
                </div>
              )}
            </>
          ) : (
            <div className="text-sm text-status-error">{lastResult.error}</div>
          )}
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
