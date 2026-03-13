import { useState } from 'react';
import { ResolverForm } from '../../../components/escalation/ResolverForm';

export function ResolverSection({
  json,
  onJsonChange,
  requestTriage,
  onRequestTriageChange,
  triageNotes,
  onTriageNotesChange,
}: {
  json: string;
  onJsonChange: (v: string) => void;
  requestTriage: boolean;
  onRequestTriageChange: (v: boolean) => void;
  triageNotes: string;
  onTriageNotesChange: (v: string) => void;
}) {
  const [resolverView, setResolverView] = useState<'form' | 'json'>('form');

  return (
    <>
      {/* Toolbar row: form/JSON toggle + triage callout */}
      <div className="flex items-center justify-between mb-3">
        {requestTriage ? (
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
        )}

        {!requestTriage && (
          <button
            onClick={() => setResolverView(resolverView === 'form' ? 'json' : 'form')}
            className="text-[10px] text-text-tertiary hover:text-accent transition-colors"
          >
            {resolverView === 'form' ? 'Raw JSON' : 'Form'}
          </button>
        )}
      </div>

      <div className="relative min-h-[200px]">
        {/* Form controls */}
        <div className={requestTriage ? 'pointer-events-none select-none' : ''}>
          {resolverView === 'form' ? (
            <ResolverForm value={json} onChange={onJsonChange} />
          ) : (
            <textarea
              value={json}
              onChange={(e) => onJsonChange(e.target.value)}
              className="input font-mono text-xs w-full"
              rows={8}
              spellCheck={false}
              data-testid="resolve-json"
            />
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
