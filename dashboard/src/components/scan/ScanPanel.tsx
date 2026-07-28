import { useState, type FormEvent } from 'react';
import { X, ScanBarcode } from 'lucide-react';
import { useScanInput } from '../../hooks/useScanInput';
import { SCAN_OUTCOMES, type ScanOutcome } from '../../api/scan-codes';
import { SimpleMarkdown } from '../common/display/SimpleMarkdown';

const OUTCOME_LABELS: Record<ScanOutcome, string> = {
  [SCAN_OUTCOMES.EXECUTED]: 'Executed',
  [SCAN_OUTCOMES.MATCHED_LIST]: 'Matched list',
  [SCAN_OUTCOMES.CONFIRM_REQUIRED]: 'Awaiting confirmation',
  [SCAN_OUTCOMES.NO_MATCH_FALLBACK]: 'No match',
  [SCAN_OUTCOMES.UNCONFIGURED]: 'Not configured',
  [SCAN_OUTCOMES.INVALID_CODE]: 'Invalid code',
  [SCAN_OUTCOMES.FORBIDDEN]: 'Not permitted',
  [SCAN_OUTCOMES.CONFLICT]: 'Conflict',
};

const OUTCOME_TONE: Record<ScanOutcome, string> = {
  [SCAN_OUTCOMES.EXECUTED]: 'text-emerald-500',
  [SCAN_OUTCOMES.MATCHED_LIST]: 'text-emerald-500',
  [SCAN_OUTCOMES.CONFIRM_REQUIRED]: 'text-amber-500',
  [SCAN_OUTCOMES.NO_MATCH_FALLBACK]: 'text-muted',
  [SCAN_OUTCOMES.UNCONFIGURED]: 'text-amber-500',
  [SCAN_OUTCOMES.INVALID_CODE]: 'text-red-500',
  [SCAN_OUTCOMES.FORBIDDEN]: 'text-red-500',
  [SCAN_OUTCOMES.CONFLICT]: 'text-amber-500',
};

/**
 * Scan panel — manual code entry (works without hardware), the last scan's
 * outcome, and the keyboard-wedge capture settings. Lives in the shell's
 * shared right SlidePanel slot.
 */
export function ScanPanel({ onClose }: { onClose: () => void }) {
  const { submitCode, lastResult, busy, wedgeConfig, updateWedgeConfig } = useScanInput();
  const [manualCode, setManualCode] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  const submitManual = (e: FormEvent) => {
    e.preventDefault();
    const code = manualCode.trim();
    if (!code) return;
    setManualCode('');
    void submitCode(code);
  };

  const response = lastResult?.response ?? null;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border">
        <div className="flex items-center gap-2 text-sm font-medium text">
          <ScanBarcode className="w-4 h-4" />
          Scan
        </div>
        <button type="button" onClick={onClose} className="text-muted hover:text" title="Close">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        <form onSubmit={submitManual} className="space-y-2">
          <label className="block text-xs uppercase tracking-wide text-muted">
            Enter a code
          </label>
          <div className="flex gap-2">
            <input
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              placeholder="1:01:SN-12345"
              className="flex-1 px-2 py-1.5 text-sm bg-surface-raised border border-surface-border rounded text"
              data-scan-manual-entry
            />
            <button
              type="submit"
              disabled={busy || !manualCode.trim()}
              className="px-3 py-1.5 text-sm rounded bg-accent text-white disabled:opacity-50"
            >
              Go
            </button>
          </div>
          <p className="text-xs text-muted">
            Scanning with a connected scanner works from any page — this entry
            exists for testing and for codes you can read but not scan.
          </p>
        </form>

        {lastResult && (
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-wide text-muted">Last scan</div>
            <div className="text-sm font-mono text">{lastResult.code}</div>
            {response ? (
              <>
                <div className={`text-sm font-medium ${OUTCOME_TONE[response.outcome]}`}>
                  {OUTCOME_LABELS[response.outcome]}
                  {response.rule ? ` — ${response.rule.name}` : ''}
                </div>
                {response.error && <div className="text-xs text-muted">{response.error}</div>}
                {response.outcome === SCAN_OUTCOMES.NO_MATCH_FALLBACK && response.fallback?.markdown && (
                  <div className="text-sm border-t border-surface-border pt-2">
                    <SimpleMarkdown content={response.fallback.markdown} compact />
                  </div>
                )}
              </>
            ) : (
              <div className="text-sm text-red-500">{lastResult.error}</div>
            )}
          </div>
        )}

        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowSettings((v) => !v)}
            className="text-xs uppercase tracking-wide text-muted hover:text"
          >
            Capture settings {showSettings ? '▾' : '▸'}
          </button>
          {showSettings && (
            <div className="space-y-3">
              <label className="block text-sm text">
                <span className="block text-xs text-muted mb-1">
                  Burst threshold (ms between keys)
                </span>
                <input
                  type="number"
                  min={20}
                  max={300}
                  value={wedgeConfig.interKeyThresholdMs}
                  onChange={(e) => updateWedgeConfig({ interKeyThresholdMs: Number(e.target.value) })}
                  className="w-24 px-2 py-1 text-sm bg-surface-raised border border-surface-border rounded"
                />
              </label>
              <label className="block text-sm text">
                <span className="block text-xs text-muted mb-1">
                  Scanner prefix character (program the scanner to send it first
                  for airtight capture)
                </span>
                <input
                  maxLength={1}
                  value={wedgeConfig.prefixChar}
                  onChange={(e) => updateWedgeConfig({ prefixChar: e.target.value })}
                  className="w-24 px-2 py-1 text-sm bg-surface-raised border border-surface-border rounded"
                />
              </label>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
