import { useEffect, useRef, useState, type FormEvent } from 'react';
import { X, ScanBarcode } from 'lucide-react';
import JsBarcode from 'jsbarcode';
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

/**
 * Undo the usual clipboard mangling before a code reaches the barcode or the
 * execute call: word processors substitute en/em dashes for hyphens and curly
 * quotes for straight ones, and copies pick up zero-width and control
 * characters. Scan codes are ASCII; restore the intended characters and drop
 * the invisible ones.
 */
export function normalizeScanCodeText(raw: string): string {
  return raw
    .replace(/[\u2010-\u2015\u2212]/g, '-') // hyphen/dash lookalikes
    .replace(/[\u2018\u2019]/g, "'") // curly single quotes
    .replace(/[\u201C\u201D]/g, '"') // curly double quotes
    .replace(/\u00A0/g, ' ') // non-breaking space
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // zero-width chars, BOM
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, '') // control chars (incl. CR/LF)
    .trim();
}

/** The characters Code 128 cannot carry, named for the error message. */
function offendingChars(value: string): string[] {
  const seen = new Set<string>();
  for (const ch of value) {
    const cp = ch.codePointAt(0)!;
    if (cp > 127 || cp < 32) {
      seen.add(`"${cp < 32 ? '\\x' + cp.toString(16).padStart(2, '0') : ch}" U+${cp.toString(16).toUpperCase().padStart(4, '0')}`);
    }
  }
  return [...seen];
}

/**
 * Live Code 128 rendering of the typed code — scan it straight off the
 * screen with a real scanner. Code 128 carries full ASCII, so delimited
 * codes ("1:04:SN-TEST-8") print verbatim.
 */
function BarcodePreview({ value }: { value: string }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!svgRef.current || !value) return;
    try {
      JsBarcode(svgRef.current, value, {
        format: 'CODE128',
        width: 2,
        height: 88,
        margin: 12,
        displayValue: true,
        fontSize: 13,
        // A barcode is a document: black bars on white, whatever the theme —
        // the scanner reads contrast, not tokens (same exception as the
        // signature pad's ink-on-white).
        background: '#ffffff',
        lineColor: '#000000',
      });
      setInvalid(false);
    } catch {
      setInvalid(true);
    }
  }, [value]);

  if (!value) return null;
  return (
    <div>
      <span className="block text-xs uppercase tracking-wide text-muted mb-1">Barcode</span>
      {invalid ? (
        <p className="text-xs text-status-error">
          This value has characters Code 128 cannot carry:{' '}
          <span className="font-mono">{offendingChars(value).join(', ') || 'unknown'}</span>
        </p>
      ) : (
        <div className="bg-white rounded p-1 inline-block max-w-full overflow-hidden">
          <svg ref={svgRef} className="max-w-full" />
        </div>
      )}
    </div>
  );
}

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
  const {
    submitCode, lastResult, busy, wedgeConfig, updateWedgeConfig,
    diagnostics, diagnosticsOn, setDiagnosticsOn,
  } = useScanInput();
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
              onChange={(e) => setManualCode(normalizeScanCodeText(e.target.value))}
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
            exists for testing and for codes you can read but not scan. Typing
            here also draws the code below; point the scanner at the screen to
            fire it for real.
          </p>
        </form>

        <BarcodePreview value={manualCode.trim()} />

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
                  Key gap limit (ms) — a longer pause between keys starts a new
                  capture; raise it for scanners that pace slowly
                </span>
                <input
                  type="number"
                  min={100}
                  max={2000}
                  step={50}
                  value={wedgeConfig.maxKeyGapMs}
                  onChange={(e) => updateWedgeConfig({ maxKeyGapMs: Number(e.target.value) })}
                  className="w-24 px-2 py-1 text-sm bg-surface-raised border border-surface-border rounded"
                />
              </label>

              <label className="flex items-center gap-2 text-sm text">
                <input
                  type="checkbox"
                  checked={diagnosticsOn}
                  onChange={(e) => setDiagnosticsOn(e.target.checked)}
                />
                <span>
                  Diagnostics — trace every keydown the capture sees (also
                  logged to the console)
                </span>
              </label>

              {diagnosticsOn && (
                <div className="border border-surface-border rounded">
                  <div className="px-2 py-1.5 text-2xs uppercase tracking-wide text-muted border-b border-surface-border">
                    Keydown trace — scan now, newest last
                  </div>
                  <div className="max-h-64 overflow-y-auto font-mono text-2xs leading-5 px-2 py-1">
                    {diagnostics.length === 0 && (
                      <div className="text-muted">Waiting for keys…</div>
                    )}
                    {diagnostics.map((d) => (
                      <div key={d.seq} className="whitespace-nowrap overflow-hidden text-ellipsis" title={`buffer: ${d.buffer}`}>
                        <span className="text-muted">{String(d.deltaMs).padStart(4)}ms </span>
                        <span className="text">{JSON.stringify(d.key)}</span>
                        {d.code && <span className="text-muted"> ({d.code})</span>}
                        <span className="text-muted"> — {d.note}</span>
                      </div>
                    ))}
                  </div>
                  <div className="px-2 py-1.5 text-2xs text-muted border-t border-surface-border">
                    Read it like this: a scan should end with an
                    {' '}<span className="font-mono">"Enter"</span> row saying
                    {' '}<span className="font-mono">capture → …</span>. An Enter row
                    saying "no code tail" means the buffer split (raise the gap
                    limit, or a key arrived as something other than one
                    character). No Enter row at all means the scanner sends no
                    suffix — program its Enter/CR suffix. Keys named
                    {' '}<span className="font-mono">"Unidentified"</span> mean the
                    decode arrives outside the keydown path.
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
