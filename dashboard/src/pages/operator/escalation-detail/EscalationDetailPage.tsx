import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { useAuth } from '../../../hooks/useAuth';
import {
  useEscalation,
  useClaimEscalation,
  useResolveEscalation,
  useEscalateToRole,
} from '../../../api/escalations';
import { useEscalationTargets } from '../../../api/roles';
import { JsonViewer } from '../../../components/common/data/JsonViewer';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { CollapsibleSection } from '../../../components/common/layout/CollapsibleSection';
import { isEffectivelyClaimed } from '../../../lib/escalation';
import { useWorkflowConfigs } from '../../../api/workflows';
import { useSettings } from '../../../api/settings';
import { useEscalationDetailEvents } from '../../../hooks/useEventHooks';
import { RoundsExhaustedContext } from '../../../components/escalation/RoundsExhaustedContext';
import { TriageContext } from '../../../components/escalation/TriageContext';
import { EscalationActionBar } from './EscalationActionBar';
import { EscalationHero } from './EscalationHero';
import { ResolverSection } from './ResolverSection';
import type { ActionBarMode, ActiveView } from './EscalationActionBar';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeParse(value: string | null | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function hasTriageData(payload: string | null | undefined): boolean {
  if (!payload) return false;
  try {
    const p = JSON.parse(payload);
    return !!(p && typeof p === 'object' && p._triage);
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function EscalationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: esc, isLoading } = useEscalation(id!);
  useEscalationDetailEvents(id);
  const claim = useClaimEscalation();
  const resolve = useResolveEscalation();
  const escalate = useEscalateToRole();
  const { data: escalationTargets } = useEscalationTargets(esc?.role ?? '');
  const { data: workflowConfigs } = useWorkflowConfigs();
  const { data: settings } = useSettings();

  const wfConfig = workflowConfigs?.find((c) => c.workflow_type === esc?.workflow_type);
  const traceUrl = settings?.telemetry?.traceUrl ?? null;
  const [activeView, setActiveView] = useState<ActiveView>('resolve');
  const [json, setJson] = useState('{}');

  // Section collapse state
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ context: false });
  const toggleSection = (key: string) =>
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));

  const [requestTriage, setRequestTriage] = useState(false);
  const [triageNotes, setTriageNotes] = useState('');
  const resolverSchema = wfConfig?.resolver_schema ?? null;
  const metadataFormSchema = (esc?.metadata as any)?.form_schema ?? null;
  const effectiveSchema = metadataFormSchema ?? resolverSchema;
  useEffect(() => {
    // Build typed form from schema with `properties` (escalation or workflow config)
    const formSchema = metadataFormSchema ?? (resolverSchema?.properties ? resolverSchema : null);
    if (formSchema?.properties) {
      const initial: Record<string, any> = { _form_schema: formSchema };
      for (const [key, def] of Object.entries(formSchema.properties)) {
        const fieldDef = def as Record<string, any>;
        initial[key] = fieldDef.default ?? '';
      }
      setJson(JSON.stringify(initial, null, 2));
    } else {
      setJson(effectiveSchema ? JSON.stringify(effectiveSchema, null, 2) : '{}');
    }
  }, [effectiveSchema, metadataFormSchema, resolverSchema]);

  // When triage or rounds-exhausted data is present, collapse Input/Output so structured context is central
  const hasTriage = hasTriageData(esc?.escalation_payload);
  const isRoundsExhausted = esc?.subtype === 'rounds_exhausted';
  const isWaitForHuman = esc?.subtype === 'wait_for_human';
  useEffect(() => {
    if (hasTriage || isRoundsExhausted) {
      setCollapsed((prev) => ({ ...prev, context: true }));
    }
    // waitFor escalations: auto-expand resolver, collapse context
    if (isWaitForHuman && metadataFormSchema) {
      setCollapsed((prev) => ({ ...prev, context: true, resolver: false }));
    }
  }, [hasTriage, isRoundsExhausted, isWaitForHuman, metadataFormSchema]);

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-8">
        <div className="h-8 bg-surface-sunken rounded w-64" />
        <div className="h-32 bg-surface-sunken rounded w-full" />
      </div>
    );
  }

  if (!esc) {
    return <p className="text-sm text-text-secondary">Escalation not found.</p>;
  }

  const claimed = isEffectivelyClaimed(esc);
  const claimedByMe = claimed && esc.assigned_to === user?.userId;
  const claimedByOther = claimed && !claimedByMe;
  const isTerminal = esc.status === 'resolved' || esc.status === 'cancelled';

  const escalationPayload = safeParse(esc.escalation_payload);
  const resolverPayload = safeParse(esc.resolver_payload);

  // Detect triage context in escalation payload
  const payloadObj = (typeof escalationPayload === 'object' && escalationPayload !== null && !Array.isArray(escalationPayload))
    ? escalationPayload as Record<string, unknown>
    : null;
  const triageData = payloadObj?._triage as Record<string, unknown> | undefined;

  // Derive action bar mode
  const actionBarMode: ActionBarMode = isTerminal
    ? 'terminal'
    : claimedByMe
      ? 'claimed_by_me'
      : claimedByOther
        ? 'claimed_by_other'
        : 'available';

  const handleClaim = (durationMinutes: number) => {
    claim.mutate({ id: esc.id, durationMinutes });
    setCollapsed({ context: true, triage: true, resolver: false });
  };

  const goBack = () => navigate(-1);

  const handleResolve = async (payload: Record<string, unknown>) => {
    await resolve.mutateAsync({ id: esc.id, resolverPayload: payload });
    goBack();
  };

  const handleEscalate = async (targetRole: string) => {
    if (!targetRole) return;
    await escalate.mutateAsync({ id: esc.id, targetRole });
    goBack();
  };

  const handleRetryTriage = async () => {
    if (!claimedByMe) {
      await claim.mutateAsync({ id: esc.id, durationMinutes: 30 });
    }
    const diagnosis = (payloadObj?.diagnosis as string) || esc.description || '';
    await resolve.mutateAsync({
      id: esc.id,
      resolverPayload: { _lt: { needsTriage: true }, notes: diagnosis },
    });
    goBack();
  };

  const handleRelease = async () => {
    await claim.mutateAsync({ id: esc.id, durationMinutes: 0 });
    goBack();
  };

  return (
    <div className="min-h-[calc(100vh-9rem)] flex flex-col">
      <PageHeader title="Escalation" />

      <EscalationHero
        esc={esc}
        claimedByMe={claimedByMe}
        claimed={claimed}
        isTerminal={isTerminal}
        traceUrl={traceUrl}
      />

      {/* Rounds-exhausted structured context */}
      {isRoundsExhausted && payloadObj && (
        <div className="mt-8">
          <RoundsExhaustedContext
            payload={payloadObj}
            isTerminal={isTerminal}
            resolverPayload={resolverPayload as Record<string, unknown> | null}
            onRetryTriage={handleRetryTriage}
            isRetrying={claim.isPending || resolve.isPending}
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

      {/* Collapsible sections */}
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
              {esc.envelope && (
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

        {/* Triage context — only when present */}
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

        {/* Resolver form — when claimed and resolving */}
        {!isTerminal && claimedByMe && activeView === 'resolve' && (esc.workflow_type || metadataFormSchema) && (
          <CollapsibleSection
            title="Submit Your Resolution"
            sectionKey="resolver"
            isCollapsed={!!collapsed.resolver}
            onToggle={toggleSection}
            contentClassName="mt-4 ml-9"
          >
            <ResolverSection
              json={json}
              onJsonChange={setJson}
              requestTriage={requestTriage}
              onRequestTriageChange={setRequestTriage}
              triageNotes={triageNotes}
              onTriageNotesChange={setTriageNotes}
            />
          </CollapsibleSection>
        )}
      </div>

      <div className="flex-1" />

      <EscalationActionBar
        mode={actionBarMode}
        activeView={activeView}
        onActiveViewChange={setActiveView}
        onClaim={handleClaim}
        claimPending={claim.isPending}
        workflowType={esc.workflow_type}
        json={json}
        onResolve={handleResolve}
        resolvePending={resolve.isPending}
        resolveError={resolve.error as Error | null}
        requestTriage={requestTriage}
        triageNotes={triageNotes}
        currentRole={esc.role}
        escalationTargets={escalationTargets?.targets ?? []}
        onEscalate={handleEscalate}
        escalatePending={escalate.isPending}
        escalateError={escalate.error as Error | null}
        onRelease={handleRelease}
        releasePending={claim.isPending}
        assignedTo={esc.assigned_to}
        assignedUntil={esc.assigned_until}
      />
    </div>
  );
}
