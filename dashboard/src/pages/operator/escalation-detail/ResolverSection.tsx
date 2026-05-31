import { useState, useMemo, useCallback } from 'react';
import { ResolverForm } from '../../../components/escalation/ResolverForm';

export function ResolverSection({
  json,
  onJsonChange,
  requestTriage,
  onRequestTriageChange,
  triageNotes,
  onTriageNotesChange,
  isDevMode = true,
  disabled = false,
  submitAttempted = false,
  showTriage = false,
}: {
  json: string;
  onJsonChange: (v: string) => void;
  requestTriage: boolean;
  onRequestTriageChange: (v: boolean) => void;
  triageNotes: string;
  onTriageNotesChange: (v: string) => void;
  isDevMode?: boolean;
  disabled?: boolean;
  submitAttempted?: boolean;
  showTriage?: boolean;
}) {
  const [resolverView, setResolverView] = useState<'form' | 'json'>('form');

  // For the JSON editor: strip _form_schema so engineers see only editable fields.
  // When they edit, merge the hidden fields back before propagating.
  const { visibleJson, hiddenFields } = useMemo(() => {
    try {
      const parsed = JSON.parse(json);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const hidden: Record<string, unknown> = {};
        const visible: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (k.startsWith('_')) hidden[k] = v;
          else visible[k] = v;
        }
        return { visibleJson: JSON.stringify(visible, null, 2), hiddenFields: hidden };
      }
    } catch { /* invalid JSON */ }
    return { visibleJson: json, hiddenFields: {} };
  }, [json]);

  const handleJsonEdit = useCallback((raw: string) => {
    try {
      const edited = JSON.parse(raw);
      // Merge hidden fields back
      onJsonChange(JSON.stringify({ ...edited, ...hiddenFields }, null, 2));
    } catch {
      // If they're mid-edit and JSON is invalid, store a merged placeholder
      // so the action bar can show a parse error on submit
      onJsonChange(raw);
    }
  }, [hiddenFields, onJsonChange]);

  const hasSchema = Object.keys(hiddenFields).length > 0;

  return (
    <>
      {/* Toolbar row: triage callout + form/JSON toggle */}
      {(showTriage || isDevMode) && (
        <div className="flex items-center justify-between mb-3">
          {showTriage ? (
            requestTriage ? (
              <button
                onClick={() => onRequestTriageChange(false)}
                className="group flex items-center gap-2 text-left"
                data-testid="triage-cancel"
              >
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-accent/10 text-accent shrink-0">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </span>
                <span className="text-xs text-text-secondary group-hover:text-text-primary transition-colors">
                  AI Triage active.{' '}
                  <span className="text-accent group-hover:underline">Cancel</span>
                </span>
              </button>
            ) : (
              <button
                onClick={() => onRequestTriageChange(true)}
                className="group flex items-center gap-2.5 text-left my-4"
                data-testid="triage-callout"
              >
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-accent/10 text-accent shrink-0 animate-[triage-glow_6s_ease-in-out_infinite]">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.674M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </span>
                <span className="text-[13px] text-text-secondary group-hover:text-text-primary transition-colors">
                  This form doesn&apos;t capture the issue?{' '}
                  <span className="text-accent group-hover:underline">Request AI Triage</span>
                </span>
              </button>
            )
          ) : (
            <span />
          )}

          {isDevMode && !requestTriage && (
            <button
              onClick={() => setResolverView(resolverView === 'form' ? 'json' : 'form')}
              className="text-[10px] text-text-tertiary hover:text-accent transition-colors"
            >
              {resolverView === 'form' ? 'Raw JSON' : 'Form'}
            </button>
          )}
        </div>
      )}

      <div className="relative min-h-[200px]">
        {/* Form controls */}
        <div className={requestTriage ? 'pointer-events-none select-none' : ''}>
          {resolverView === 'form' ? (
            <ResolverForm value={json} onChange={onJsonChange} disabled={disabled} submitAttempted={submitAttempted} />
          ) : (
            <div>
              {hasSchema && (
                <p className="text-[10px] text-text-quaternary mb-2 italic">
                  Form schema hidden. Edit the resolver values below — they will be merged with the schema on submit.
                </p>
              )}
              <textarea
                value={visibleJson}
                onChange={(e) => handleJsonEdit(e.target.value)}
                className="input-json w-full"
                rows={Math.max(8, visibleJson.split('\n').length + 2)}
                spellCheck={false}
                data-testid="resolve-json"
              />
            </div>
          )}
        </div>

        {/* Triage overlay — occludes the form when AI Triage is checked */}
        {requestTriage && (
          <div
            className="absolute inset-0 z-10 flex flex-col bg-surface/90 backdrop-blur-[2px] rounded-md border border-accent/20 p-5"
            data-testid="triage-overlay"
          >
            <p className="text-xs text-text-secondary mb-3 leading-relaxed">
              The resolution form will not be submitted. Describe the issue
              so AI triage can diagnose and fix it using available tools.
              The corrected result will come back as a new escalation for
              your review.
            </p>
            <textarea
              value={triageNotes}
              onChange={(e) => onTriageNotesChange(e.target.value)}
              placeholder="e.g. Content is in Spanish — needs translation to English before review..."
              className="input text-xs w-full flex-1 min-h-[80px] resize-none"
              autoFocus
              data-testid="triage-notes"
            />
          </div>
        )}
      </div>
    </>
  );
}
