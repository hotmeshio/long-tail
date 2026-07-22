import { Link } from 'react-router-dom';
import { KeyRound, MonitorPlay } from 'lucide-react';
import { RoundsExhaustedContext } from '../../../components/escalation/RoundsExhaustedContext';
import { IframeViewport } from '../../../components/escalation/IframeViewport';
import { ResolverForm } from '../../../components/escalation/ResolverForm';
import { mapPayloadToForm } from '../../../lib/x-lt-bind';
import type { ShowIfContext } from '../../../lib/x-lt-show-if';
import { ResolverSection } from './ResolverSection';
import type { ActiveView } from './EscalationActionBar';
import type { LTEscalationRecord } from '../../../api/types';

/**
 * Expands `{key}` tokens in a viewport src URL using values from the
 * escalation's payload, envelope, and metadata — merged in that order so
 * escalation_payload values win over envelope, and envelope wins over metadata.
 *
 * This mirrors how the existing form schemas map envelope/metadata values into
 * default field values, but applied to the iframe src URL.
 */
export function expandViewportSrc(src: string, esc: LTEscalationRecord): string {
  if (!src.includes('{')) return src;
  try {
    const parse = (s: string | null | undefined): Record<string, unknown> => {
      if (!s) return {};
      try { return JSON.parse(s) as Record<string, unknown>; } catch { return {}; }
    };
    const merged = {
      ...(esc.metadata ?? {}),
      ...parse(esc.envelope),
      ...parse(esc.escalation_payload),
    };
    return src.replace(/\{([^}]+)\}/g, (_, key) =>
      Object.prototype.hasOwnProperty.call(merged, key) ? String(merged[key]) : `{${key}}`
    );
  } catch {
    return src;
  }
}

function parseJson(s: string | null | undefined): Record<string, unknown> | null {
  if (!s) return null;
  try { return JSON.parse(s) as Record<string, unknown>; } catch { return null; }
}

export function buildShowIfContext(esc: LTEscalationRecord): ShowIfContext {
  return {
    escalation: esc as unknown as Record<string, unknown>,
    metadata: esc.metadata ?? null,
    envelope: parseJson(esc.envelope),
    payload: parseJson(esc.escalation_payload),
    resolver: null,
  };
}

interface EscalationContextProps {
  isRoundsExhausted: boolean;
  payloadObj: Record<string, unknown> | null;
  isTerminal: boolean;
  resolverPayload: Record<string, unknown> | null;
  onRetryTriage: () => Promise<void>;
  isRetrying: boolean;
}

export function EscalationContextBlocks({
  isRoundsExhausted,
  payloadObj,
  isTerminal,
  resolverPayload,
  onRetryTriage,
  isRetrying,
}: EscalationContextProps) {
  return (
    <>
      {/* Rounds-exhausted structured context */}
      {isRoundsExhausted && payloadObj && (
        <div className="mt-8">
          <RoundsExhaustedContext
            payload={payloadObj}
            isTerminal={isTerminal}
            resolverPayload={resolverPayload}
            onRetryTriage={onRetryTriage}
            isRetrying={isRetrying}
          />
        </div>
      )}

      {/* Missing credential context */}
      {payloadObj?.category === 'missing_credential' && (
        <div className="mt-8 bg-status-warning/10 border border-status-warning/30 rounded-md px-5 py-4 flex items-start gap-3">
          <KeyRound size={20} className="text-status-warning mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-text-primary mb-1">Missing Credential</p>
            <p className="text-xs text-text-secondary mb-3">
              This workflow requires a <span className="font-medium capitalize">{String(payloadObj.provider)}</span> credential
              to continue. Register one and then resolve this escalation to retry.
            </p>
            <Link
              to="/credentials"
              className="btn-primary text-xs inline-flex items-center gap-1.5"
            >
              <KeyRound size={12} />
              Go to Credentials
            </Link>
          </div>
        </div>
      )}
    </>
  );
}

interface FormSectionProps {
  esc: LTEscalationRecord;
  resolverPayload: unknown;
  isTerminal: boolean;
  claimedByMe: boolean;
  activeView: ActiveView;
  metadataFormSchema: unknown;
  /** The resolved form schema (metadata-embedded, role-owned, or workflow fallback). */
  effectiveSchema: Record<string, unknown> | null;
  json: string;
  onJsonChange: (v: string) => void;
  requestTriage: boolean;
  onRequestTriageChange: (v: boolean) => void;
  triageNotes: string;
  onTriageNotesChange: (v: string) => void;
  onResolve?: (payload: Record<string, unknown>) => void;
  onEscalate?: (targetRole: string) => void;
  onClaim?: () => void;
  submitAttempted?: boolean;
  isCertified?: boolean;
  hasAI?: boolean;
  /** Opens the Instructions side-panel view (form help icon). */
  onOpenHelp?: () => void;
}

/**
 * The form area — the page's single, direct surface: the resolve form (or a
 * custom iframe viewport), shown even before claiming and enabled by the
 * claim. Terminal escalations render the submitted resolution read-only.
 * Everything else about the record lives in the side panel.
 */
export function EscalationFormSection({
  esc,
  resolverPayload,
  isTerminal,
  claimedByMe,
  activeView,
  metadataFormSchema,
  effectiveSchema,
  json,
  onJsonChange,
  requestTriage,
  onRequestTriageChange,
  triageNotes,
  onTriageNotesChange,
  onResolve,
  onEscalate,
  onClaim,
  submitAttempted,
  isCertified,
  hasAI,
  onOpenHelp,
}: FormSectionProps) {
  const schema = effectiveSchema;
  const showIfCtx = buildShowIfContext(esc);

  // Terminal: show the submitted resolution read-only. The stored payload is
  // the NESTED shape (mapped through x-lt-bind on submit) — reverse-map it
  // back to flat form fields so the resolution renders as the same two-column
  // form it was filled in on, not as raw payload sections.
  if (isTerminal) {
    if (resolverPayload == null) return null;
    const payload = typeof resolverPayload === 'object' && resolverPayload !== null
      ? resolverPayload as Record<string, unknown>
      : {};
    const formSchema = (effectiveSchema ?? (metadataFormSchema as Record<string, any> | null));
    const value = formSchema?.properties
      ? { ...mapPayloadToForm(payload, formSchema), _form_schema: formSchema }
      : payload;
    return (
      <div className="mt-3">
        <ResolverForm
          value={JSON.stringify(value, null, 2)}
          onChange={() => {}}
          disabled
          escalationContext={showIfCtx}
        />
      </div>
    );
  }

  if (activeView !== 'resolve' || !(esc.workflow_type || effectiveSchema)) return null;

  const viewport = schema?.['x-lt-viewport'] as { type?: string; src?: string } | undefined;
  const isIframeViewport = viewport?.type === 'iframe' && !!viewport.src && onResolve && onEscalate;

  if (isIframeViewport && !claimedByMe) {
    return (
      <button
        onClick={() => onClaim?.()}
        disabled={!onClaim}
        className="flex flex-col items-center justify-center min-h-[55vh] w-full gap-3 text-center group disabled:opacity-50 disabled:cursor-default"
      >
        <MonitorPlay className="w-10 h-10 text-text-tertiary group-hover:text-accent transition-colors" strokeWidth={1} />
        <p className="text-base font-medium text-text-primary group-hover:text-accent transition-colors">Claim to launch the editor</p>
      </button>
    );
  }

  const resolvedSrc = isIframeViewport ? expandViewportSrc(viewport!.src!, esc) : '';

  return (
    <div className="mt-3">
      {isIframeViewport ? (
        <IframeViewport
          src={resolvedSrc}
          escalation={esc}
          schema={schema!}
          onResolve={onResolve!}
          onEscalate={onEscalate!}
          submitAttempted={submitAttempted}
        />
      ) : (
        <ResolverSection
          json={json}
          onJsonChange={onJsonChange}
          requestTriage={requestTriage}
          onRequestTriageChange={onRequestTriageChange}
          triageNotes={triageNotes}
          onTriageNotesChange={onTriageNotesChange}
          disabled={!claimedByMe}
          submitAttempted={submitAttempted}
          showTriage={!!isCertified && !!hasAI}
          escalationContext={showIfCtx}
          onOpenHelp={onOpenHelp}
        />
      )}
    </div>
  );
}
