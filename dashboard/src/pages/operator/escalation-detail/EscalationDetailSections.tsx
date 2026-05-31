import { Link } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { CollapsibleSection } from '../../../components/common/layout/CollapsibleSection';
import { JsonViewer } from '../../../components/common/data/JsonViewer';
import { RoundsExhaustedContext } from '../../../components/escalation/RoundsExhaustedContext';
import { TriageContext } from '../../../components/escalation/TriageContext';
import { IframeViewport } from '../../../components/escalation/IframeViewport';
import { ResolverForm } from '../../../components/escalation/ResolverForm';
import { CopyableId } from '../../../components/common/display/CopyableId';
import { DateValue } from '../../../components/common/display/DateValue';
import { ResolverSection } from './ResolverSection';
import type { ActiveView } from './EscalationActionBar';
import type { LTEscalationRecord } from '../../../api/types';

// ── Dev-mode record summary ─────────────────────────────────────────────

function MetaLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary">{children}</span>;
}

function MetaValue({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] text-text-secondary mt-0.5 font-mono">{children}</p>;
}

function EscalationRecordSummary({ esc }: { esc: LTEscalationRecord }) {
  return (
    <div className="space-y-6">
      {/* Identity + Classification */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-accent/60 mb-3">Classification</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-4">
          <div>
            <MetaLabel>Type</MetaLabel>
            <MetaValue>{esc.type}</MetaValue>
          </div>
          {esc.subtype && (
            <div>
              <MetaLabel>Subtype</MetaLabel>
              <MetaValue>{esc.subtype}</MetaValue>
            </div>
          )}
          <div>
            <MetaLabel>Priority</MetaLabel>
            <MetaValue>P{esc.priority}</MetaValue>
          </div>
          <div>
            <MetaLabel>Status</MetaLabel>
            <MetaValue>{esc.status}</MetaValue>
          </div>
        </div>
      </div>

      {/* References */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-accent/60 mb-3">References</p>
        <div className="flex flex-wrap gap-x-8 gap-y-4">
          <CopyableId label="Escalation ID" value={esc.id} />
          {esc.task_id && <CopyableId label="Task ID" value={esc.task_id} href={`/workflows/tasks/detail/${esc.task_id}`} />}
          {esc.workflow_type && <CopyableId label="Workflow Name" value={esc.workflow_type} href={`/workflows/registry/${esc.workflow_type}`} />}
          {esc.workflow_id && <CopyableId label="Workflow ID" value={esc.workflow_id} href={`/workflows/executions/${esc.workflow_id}`} />}
          {esc.task_queue && <CopyableId label="Task Queue" value={esc.task_queue} />}
          {esc.origin_id && esc.origin_id !== esc.workflow_id && <CopyableId label="Origin ID" value={esc.origin_id} />}
          {esc.parent_id && <CopyableId label="Parent ID" value={esc.parent_id} />}
          {esc.trace_id && <CopyableId label="Trace ID" value={esc.trace_id} />}
          {esc.span_id && <CopyableId label="Span ID" value={esc.span_id} />}
        </div>
      </div>

      {/* Timestamps */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-accent/60 mb-3">Timeline</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-4">
          <div>
            <MetaLabel>Created</MetaLabel>
            <p className="text-[12px] text-text-secondary mt-0.5"><DateValue date={esc.created_at} /></p>
          </div>
          {esc.claimed_at && (
            <div>
              <MetaLabel>Claimed</MetaLabel>
              <p className="text-[12px] text-text-secondary mt-0.5"><DateValue date={esc.claimed_at} /></p>
            </div>
          )}
          {esc.resolved_at && (
            <div>
              <MetaLabel>Resolved</MetaLabel>
              <p className="text-[12px] text-text-secondary mt-0.5"><DateValue date={esc.resolved_at} /></p>
            </div>
          )}
          <div>
            <MetaLabel>Updated</MetaLabel>
            <p className="text-[12px] text-text-secondary mt-0.5"><DateValue date={esc.updated_at} /></p>
          </div>
        </div>
      </div>

      {/* Metadata (raw JSON) */}
      {esc.metadata && Object.keys(esc.metadata).length > 0 && (
        <div>
          <JsonViewer data={esc.metadata} label="Metadata" />
        </div>
      )}
    </div>
  );
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
  submitAttempted?: boolean;
  isCertified?: boolean;
  hasAI?: boolean;
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
  submitAttempted,
  isCertified,
  hasAI,
}: CollapsibleSectionsProps) {
  return (
    <div className="mt-8 space-y-6">
      {/* Escalation Record — dev mode only, always visible by default */}
      {isDevMode && (
        <CollapsibleSection
          title="Escalation Record"
          sectionKey="record"
          isCollapsed={isCollapsed('record')}
          onToggle={toggleSection}
          contentClassName="mt-4 ml-9"
        >
          <EscalationRecordSummary esc={esc} />
        </CollapsibleSection>
      )}

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
                  submitAttempted={submitAttempted}
                  showTriage={!!isCertified && !!hasAI}
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
                submitAttempted={submitAttempted}
                showTriage={!!isCertified && !!hasAI}
              />
            )}
          </CollapsibleSection>
        );
      })()}
    </div>
  );
}
