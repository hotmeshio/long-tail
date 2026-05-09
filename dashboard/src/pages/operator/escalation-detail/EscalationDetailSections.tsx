import { Link } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { CollapsibleSection } from '../../../components/common/layout/CollapsibleSection';
import { JsonViewer } from '../../../components/common/data/JsonViewer';
import { RoundsExhaustedContext } from '../../../components/escalation/RoundsExhaustedContext';
import { TriageContext } from '../../../components/escalation/TriageContext';
import { ResolverSection } from './ResolverSection';
import type { ActiveView } from './EscalationActionBar';

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
  collapsed: Record<string, boolean>;
  toggleSection: (key: string) => void;
  esc: {
    envelope?: unknown;
    workflow_type?: string | null;
    metadata?: unknown;
  };
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
}

export function EscalationCollapsibleSections({
  collapsed,
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
}: CollapsibleSectionsProps) {
  return (
    <div className="mt-8 space-y-6">
      {/* Input/Output */}
      <CollapsibleSection
        title="Input / Output"
        sectionKey="context"
        isCollapsed={collapsed.context ?? true}
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

      {/* Triage context */}
      {triageData && payloadObj && (
        <CollapsibleSection
          title="AI Triage"
          sectionKey="triage"
          isCollapsed={!!collapsed.triage}
          onToggle={toggleSection}
          contentClassName="mt-4 ml-9"
        >
          <TriageContext triage={triageData} payload={payloadObj} />
        </CollapsibleSection>
      )}

      {/* Resolver form */}
      {!isTerminal && claimedByMe && activeView === 'resolve' && !!(esc.workflow_type || metadataFormSchema) && (
        <CollapsibleSection
          title="Submit Your Resolution"
          sectionKey="resolver"
          isCollapsed={!!collapsed.resolver}
          onToggle={toggleSection}
          contentClassName="mt-4 ml-9"
        >
          <ResolverSection
            json={json}
            onJsonChange={onJsonChange}
            requestTriage={requestTriage}
            onRequestTriageChange={onRequestTriageChange}
            triageNotes={triageNotes}
            onTriageNotesChange={onTriageNotesChange}
          />
        </CollapsibleSection>
      )}
    </div>
  );
}
