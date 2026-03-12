interface TriageData {
  diagnosis?: string;
  actions_taken?: string[];
  tool_calls_made?: number;
  confidence?: number;
  recommendation?: string;
  correctedData?: Record<string, unknown>;
  originalData?: Record<string, unknown>;
}

type Diff = { key: string; label: string; original: unknown; corrected: unknown };

/**
 * Renders a triage summary when escalation payload contains `_triage`.
 *
 * Fully generic — no knowledge of workflow types or field semantics.
 * Diffs `_triage.originalData` against the payload to detect changes.
 * Follows the unboxed section pattern used throughout the dashboard.
 */
export function TriageContext({ triage, payload }: {
  triage: TriageData;
  payload: Record<string, unknown>;
}) {
  const confidence = triage.confidence ?? 0;
  const confidenceColor =
    confidence >= 0.8 ? 'text-status-success' :
    confidence >= 0.5 ? 'text-status-pending' :
    'text-status-error';

  // Generic diff: compare originalData fields to current payload
  const diffs = computeDiffs(triage.originalData, payload);

  return (
    <div className="space-y-5">
      {/* Diagnosis + metadata — unboxed, natural flow */}
      {triage.diagnosis && (
        <p className="text-sm text-text-primary leading-relaxed">
          {triage.diagnosis}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs text-text-tertiary">
        {triage.tool_calls_made != null && (
          <span>{triage.tool_calls_made} tool call{triage.tool_calls_made !== 1 ? 's' : ''}</span>
        )}
        {triage.tool_calls_made != null && <span className="text-text-quaternary">&middot;</span>}
        <span className={`font-medium ${confidenceColor}`}>
          {Math.round(confidence * 100)}% confidence
        </span>
      </div>

      {triage.actions_taken && triage.actions_taken.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {triage.actions_taken.map((action, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px]
                         text-text-secondary"
            >
              <svg className="w-3 h-3 text-status-success shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              {action}
            </span>
          ))}
        </div>
      )}

      {triage.recommendation && (
        <p className="text-[11px] text-text-tertiary italic">
          {triage.recommendation}
        </p>
      )}

      {/* Generic before/after diffs — separated by subtle dividers */}
      {diffs.length > 0 && (
        <div className="space-y-4 pt-2">
          {diffs.map((diff) => (
            <DiffRow key={diff.key} diff={diff} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generic diff computation
// ---------------------------------------------------------------------------

function computeDiffs(
  original: Record<string, unknown> | undefined,
  current: Record<string, unknown>,
): Diff[] {
  if (!original) return [];

  const diffs: Diff[] = [];
  for (const key of Object.keys(original)) {
    if (key.startsWith('_')) continue;
    const origVal = original[key];
    const currVal = current[key];
    if (currVal === undefined) continue;

    if (JSON.stringify(origVal) !== JSON.stringify(currVal)) {
      diffs.push({
        key,
        label: key.replace(/[_-]/g, ' '),
        original: origVal,
        corrected: currVal,
      });
    }
  }
  return diffs;
}

// ---------------------------------------------------------------------------
// Diff row — clean, unboxed before/after
// ---------------------------------------------------------------------------

function DiffRow({ diff }: { diff: Diff }) {
  const origStr = renderValue(diff.original);
  const corrStr = renderValue(diff.corrected);

  // Both are primitives — side by side with subtle separator
  if (origStr !== null && corrStr !== null) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
            {diff.label} <span className="normal-case font-normal">(original)</span>
          </p>
          <p className="text-sm text-text-tertiary leading-relaxed line-through decoration-text-tertiary/30">
            {origStr}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
            {diff.label} <span className="normal-case font-normal text-status-success">(corrected)</span>
          </p>
          <p className="text-sm text-text-primary leading-relaxed">
            {corrStr}
          </p>
        </div>
      </div>
    );
  }

  // Complex values — stacked
  return (
    <div className="space-y-3">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
          {diff.label} <span className="normal-case font-normal">(original)</span>
        </p>
        <pre className="text-xs text-text-tertiary font-mono whitespace-pre-wrap leading-relaxed">
          {typeof diff.original === 'object' ? JSON.stringify(diff.original, null, 2) : String(diff.original)}
        </pre>
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
          {diff.label} <span className="normal-case font-normal text-status-success">(corrected)</span>
        </p>
        <pre className="text-xs text-text-primary font-mono whitespace-pre-wrap leading-relaxed">
          {typeof diff.corrected === 'object' ? JSON.stringify(diff.corrected, null, 2) : String(diff.corrected)}
        </pre>
      </div>
    </div>
  );
}

/** Render a value as a string if it's a primitive, null otherwise */
function renderValue(val: unknown): string | null {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return null;
}
