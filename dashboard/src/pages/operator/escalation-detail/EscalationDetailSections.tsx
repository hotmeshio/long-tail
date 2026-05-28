import { Link } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { CollapsibleSection } from '../../../components/common/layout/CollapsibleSection';
import { JsonViewer } from '../../../components/common/data/JsonViewer';
import { RoundsExhaustedContext } from '../../../components/escalation/RoundsExhaustedContext';
import { TriageContext } from '../../../components/escalation/TriageContext';
import { IframeViewport } from '../../../components/escalation/IframeViewport';
import { ResolverForm } from '../../../components/escalation/ResolverForm';
import { ResolverSection } from './ResolverSection';
import type { ActiveView } from './EscalationActionBar';
import type { LTEscalationRecord } from '../../../api/types';

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

interface CollapsibleSectionsProps {
  isCollapsed: (key: string) => boolean;
  toggleSection: (key: string) => void;
  esc: LTEscalationRecord;
  escalationPayload: unknown;
  resolverPayload: unknown;
  triageData?: Record<string, unknown>;
  payloadObj: Record<string, unknown> | null;
  isTerminal: boolean;
  claimedByMe: boolean;
  activeView: ActiveView;
  metadataFormSchema: unknown;
  json: string;
  onJsonChange: (v: string) => void;
  requestTriage: boolean;
  onRequestTriageChange: (v: boolean) => void;
  triageNotes: string;
  onTriageNotesChange: (v: string) => void;
  isDevMode: boolean;
  onResolve?: (payload: Record<string, unknown>) => void;
  onEscalate?: (targetRole: string) => void;
}

export function EscalationCollapsibleSections({
  isCollapsed,
  toggleSection,
  esc,
  escalationPayload,
  resolverPayload,
  triageData,
  payloadObj,
  isTerminal,
  claimedByMe,
  activeView,
  metadataFormSchema,
  json,
  onJsonChange,
  requestTriage,
  onRequestTriageChange,
  triageNotes,
  onTriageNotesChange,
  isDevMode,
  onResolve,
  onEscalate,
}: CollapsibleSectionsProps) {
  return (
    <div className="mt-8 space-y-6">
      {/* Input/Output — dev mode only */}
      {isDevMode && (
        <CollapsibleSection
          title="Input / Output"
          sectionKey="context"
          isCollapsed={isCollapsed('context')}
          onToggle={toggleSection}
          contentClassName="mt-4 ml-9"
        >
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {!!esc.envelope && (
                <div>
                  <JsonViewer data={esc.envelope} label="Input Envelope" />
                </div>
              )}
              {escalationPayload != null && (
                <div>
                  <JsonViewer data={escalationPayload} label="Escalation Context" />
                </div>
              )}
            </div>

            {resolverPayload != null && (
              <div className="max-w-xl">
                <JsonViewer data={resolverPayload} label="Resolver Payload" />
              </div>
            )}
          </div>
        </CollapsibleSection>
      )}

      {/* Triage context — dev mode only */}
      {isDevMode && triageData && payloadObj && (
        <CollapsibleSection
          title="AI Triage"
          sectionKey="triage"
          isCollapsed={isCollapsed('triage')}
          onToggle={toggleSection}
          contentClassName="mt-4 ml-9"
        >
          <TriageContext triage={triageData} payload={payloadObj} />
        </CollapsibleSection>
      )}

      {/* User mode: show read-only resolver payload when terminal */}
      {!isDevMode && isTerminal && resolverPayload != null && (() => {
        const payload = typeof resolverPayload === 'object' && resolverPayload !== null
          ? resolverPayload as Record<string, unknown>
          : {};
        const schema = metadataFormSchema as Record<string, unknown> | null;
        const merged = schema ? { ...payload, _form_schema: schema } : payload;
        return (
          <div className="pt-6">
            <ResolverForm
              value={JSON.stringify(merged, null, 2)}
              onChange={() => {}}
              disabled
            />
          </div>
        );
      })()}

      {/* Resolver form or iframe viewport — in user mode, show even before claiming */}
      {!isTerminal && (claimedByMe || !isDevMode) && activeView === 'resolve' && !!(esc.workflow_type || metadataFormSchema) && (() => {
        const schema = metadataFormSchema as Record<string, unknown> | null;
        const viewport = schema?.['x-lt-viewport'] as { type?: string; src?: string } | undefined;
        const isIframeViewport = viewport?.type === 'iframe' && !!viewport.src && onResolve && onEscalate;

        // ── User mode: clean section with divider ──
        if (!isDevMode) {
          return (
            <div className="pt-6">

              {/* Form */}
              {isIframeViewport ? (
                <IframeViewport
                  src={viewport!.src!}
                  escalation={esc}
                  schema={schema!}
                  onResolve={onResolve!}
                  onEscalate={onEscalate!}
                />
              ) : (
                <ResolverSection
                  json={json}
                  onJsonChange={onJsonChange}
                  requestTriage={requestTriage}
                  onRequestTriageChange={onRequestTriageChange}
                  triageNotes={triageNotes}
                  onTriageNotesChange={onTriageNotesChange}
                  isDevMode={isDevMode}
                  disabled={!claimedByMe}
                />
              )}
            </div>
          );
        }

        // ── Dev mode: collapsible section ──
        return (
          <CollapsibleSection
            title="Submit Your Resolution"
            sectionKey="resolver"
            isCollapsed={isCollapsed('resolver')}
            onToggle={toggleSection}
            contentClassName="mt-4 ml-9"
          >
            {isIframeViewport ? (
              <IframeViewport
                src={viewport!.src!}
                escalation={esc}
                schema={schema!}
                onResolve={onResolve!}
                onEscalate={onEscalate!}
              />
            ) : (
              <ResolverSection
                json={json}
                onJsonChange={onJsonChange}
                requestTriage={requestTriage}
                onRequestTriageChange={onRequestTriageChange}
                triageNotes={triageNotes}
                onTriageNotesChange={onTriageNotesChange}
                isDevMode={isDevMode}
              />
            )}
          </CollapsibleSection>
        );
      })()}
    </div>
  );
}
