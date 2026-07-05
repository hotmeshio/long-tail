import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../hooks/useAuth';
import { useAccess } from '../../../hooks/useAccess';
import { useViewMode } from '../../../hooks/useViewMode';
import { useCollapsedSections } from '../../../hooks/useCollapsedSections';
import {
  useEscalation,
  useClaimEscalation,
  useResolveEscalation,
  useEscalateToRole,
  useCancelEscalation,
} from '../../../api/escalations';
import { ConfirmCancelModal } from '../../../components/common/modal/ConfirmCancelModal';
import { useEscalationTargets } from '../../../api/roles';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { EscalationTimeline } from '../../../components/common/display/EscalationTimeline';
import { ListToolbar } from '../../../components/common/data/ListToolbar';
import { isEffectivelyClaimed } from '../../../lib/escalation';
import { useWorkflowConfigs } from '../../../api/workflows';
import { useRoleDetails, useRoleSchema } from '../../../api/roles';
import { useSettings } from '../../../api/settings';
import { useEscalationDetailEvents } from '../../../hooks/useEventHooks';
import { EscalationActionBar } from './EscalationActionBar';
import { EscalationHero } from './EscalationHero';
import type { ActionBarMode, ActiveView } from './EscalationActionBar';
import { EscalationContextBlocks, EscalationCollapsibleSections } from './EscalationDetailSections';

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
  const queryClient = useQueryClient();
  const { data: esc, isLoading, refetch, isFetching } = useEscalation(id!);
  useEscalationDetailEvents(id);
  const claim = useClaimEscalation();
  const resolve = useResolveEscalation();
  const escalate = useEscalateToRole();
  const cancel = useCancelEscalation();
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const { data: escalationTargets } = useEscalationTargets(esc?.role ?? '');
  const { data: workflowConfigs } = useWorkflowConfigs();
  const { data: roleDetailsData } = useRoleDetails();
  const { data: settings } = useSettings();

  const { isBuilder } = useAccess();
  const { isDevMode, toggleMode } = useViewMode(false);

  const wfConfig = workflowConfigs?.find((c) => c.workflow_type === esc?.workflow_type);
  const roleDetail = roleDetailsData?.roles.find((r) => r.role === esc?.role);
  const traceUrl = settings?.telemetry?.traceUrl ?? null;
  const [activeView, setActiveView] = useState<ActiveView>('resolve');
  const [json, setJson] = useState('{}');

  // Section collapse state — persisted to localStorage
  const { isCollapsed, toggle: toggleSection, collapse, expand } = useCollapsedSections('escalation-detail');

  const [requestTriage, setRequestTriage] = useState(false);
  const [triageNotes, setTriageNotes] = useState('');
  const [submitAttempted, setSubmitAttempted] = useState(false);
  // Schema resolution, most specific first:
  //   1. metadata.form_schema — a full schema embedded on the row
  //   2. metadata.schema_version — the role schema snapshot the workflow
  //      pinned at creation (conditionLT schemaVersion); renders that exact
  //      version even after the role's schema moves on
  //   3. workflow-level resolver_schema
  //   4. the role's latest form_schema
  const metadataFormSchema = (esc?.metadata as any)?.form_schema ?? null;
  const pinnedVersion: number | null = (esc?.metadata as any)?.schema_version ?? null;
  const pinnedQuery = useRoleSchema(esc?.role ?? '', pinnedVersion ?? undefined, pinnedVersion != null);
  const pinnedFormSchema = pinnedVersion != null ? (pinnedQuery.data?.form_schema ?? null) : null;
  const resolverSchema =
    (pinnedFormSchema ?? wfConfig?.resolver_schema ?? roleDetail?.form_schema ?? null) as Record<string, any> | null;
  const effectiveSchema = metadataFormSchema ?? resolverSchema;

  // Initialize json from schema exactly once. Subsequent esc refetches
  // (claim events, real-time updates) must NOT reset user edits.
  const jsonInitialized = useRef(false);
  useEffect(() => {
    if (jsonInitialized.current) return;
    // A pinned version is still in flight — wait so the form never
    // initializes from the latest schema and then swaps under the user.
    if (pinnedVersion != null && !metadataFormSchema && pinnedQuery.data === undefined && !pinnedQuery.isError) return;
    const formSchema = metadataFormSchema ?? (resolverSchema?.properties ? resolverSchema : null);
    if (formSchema?.properties) {
      jsonInitialized.current = true;
      const initial: Record<string, any> = { _form_schema: formSchema };
      for (const [key, def] of Object.entries(formSchema.properties)) {
        const fieldDef = def as Record<string, any>;
        initial[key] = fieldDef.default ?? '';
      }
      setJson(JSON.stringify(initial, null, 2));
    } else if (effectiveSchema) {
      jsonInitialized.current = true;
      setJson(JSON.stringify(effectiveSchema, null, 2));
    }
  }, [effectiveSchema, metadataFormSchema, resolverSchema, pinnedVersion, pinnedQuery.data, pinnedQuery.isError]);

  const hasTriage = hasTriageData(esc?.escalation_payload);
  const isRoundsExhausted = esc?.subtype === 'rounds_exhausted';
  const isWaitForHuman = esc?.subtype === 'wait_for_human';
  useEffect(() => {
    if (hasTriage || isRoundsExhausted) {
      collapse('context');
    }
    if (isWaitForHuman && metadataFormSchema) {
      collapse('context');
      expand('resolver');
    }
  }, [hasTriage, isRoundsExhausted, isWaitForHuman, metadataFormSchema, collapse, expand]);

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
  const envelopeObj = safeParse(esc.envelope) as Record<string, any> | null;
  const isCertified = !!(envelopeObj?.metadata?.certified);
  const hasAI = !!(settings as any)?.ai?.enabled;

  const payloadObj = (typeof escalationPayload === 'object' && escalationPayload !== null && !Array.isArray(escalationPayload))
    ? escalationPayload as Record<string, unknown>
    : null;
  const triageData = payloadObj?._triage as Record<string, unknown> | undefined;

  const actionBarMode: ActionBarMode = isTerminal
    ? 'terminal'
    : claimedByMe
      ? 'claimed_by_me'
      : claimedByOther
        ? 'claimed_by_other'
        : 'available';

  const handleClaim = (durationMinutes: number) => {
    claim.mutate({ id: esc.id, durationMinutes });
    collapse('context');
    collapse('triage');
    expand('resolver');
  };

  const goBack = () => {
    queryClient.resetQueries({ queryKey: ['escalations'] });
    queryClient.resetQueries({ queryKey: ['escalationStats'] });
    navigate(-1);
  };

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

  const handleConfirmCancel = async () => {
    await cancel.mutateAsync(esc.id);
    setCancelModalOpen(false);
    goBack();
  };

  const viewToggle = isBuilder ? (
    <button
      onClick={toggleMode}
      className="text-text-tertiary hover:text-accent transition-colors"
      title={isDevMode ? 'Switch to user view' : 'Switch to developer view'}
    >
      {isDevMode ? (
        /* Braces icon — dev/JSON mode */
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
        </svg>
      ) : (
        /* Form/document icon — user mode */
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      )}
    </button>
  ) : undefined;

  const headerActions = (
    <div className="flex items-center gap-2">
      <ListToolbar
        onRefresh={() => refetch()}
        isFetching={isFetching}
        apiPath={`/escalations/${esc.id}`}
      />
      {viewToggle && <div className="ml-4">{viewToggle}</div>}
    </div>
  );

  return (
    <div className="min-h-[calc(100vh-9rem)] flex flex-col">
      <PageHeader
        title="Escalation"
        actions={headerActions}
        center={<EscalationTimeline esc={esc} className="w-[25%] shrink-0" />}
      />

      <EscalationHero
        esc={esc}
        claimedByMe={claimedByMe}
        claimed={claimed}
        isTerminal={isTerminal}
        traceUrl={traceUrl}
        isDevMode={isDevMode}
        showDetails={!isCollapsed('details')}
        onToggleDetails={() => toggleSection('details')}
      />

      <EscalationContextBlocks
        isRoundsExhausted={isRoundsExhausted}
        payloadObj={payloadObj}
        isTerminal={isTerminal}
        resolverPayload={resolverPayload as Record<string, unknown> | null}
        onRetryTriage={handleRetryTriage}
        isRetrying={claim.isPending || resolve.isPending}
      />

      <EscalationCollapsibleSections
        isCollapsed={isCollapsed}
        toggleSection={toggleSection}
        esc={esc}
        escalationPayload={escalationPayload}
        resolverPayload={resolverPayload}
        triageData={triageData}
        payloadObj={payloadObj}
        isTerminal={isTerminal}
        claimedByMe={claimedByMe}
        activeView={activeView}
        metadataFormSchema={metadataFormSchema}
        json={json}
        onJsonChange={setJson}
        requestTriage={requestTriage}
        onRequestTriageChange={setRequestTriage}
        triageNotes={triageNotes}
        onTriageNotesChange={setTriageNotes}
        isDevMode={isDevMode}
        onResolve={handleResolve}
        onEscalate={handleEscalate}
        submitAttempted={submitAttempted}
        isCertified={isCertified}
        hasAI={hasAI}
      />

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
        escalationTargets={(escalationTargets?.targets ?? []).filter((r) => r !== esc.role)}
        onEscalate={handleEscalate}
        escalatePending={escalate.isPending}
        escalateError={escalate.error as Error | null}
        onRelease={handleRelease}
        releasePending={claim.isPending}
        onCancel={() => setCancelModalOpen(true)}
        assignedTo={esc.assigned_to}
        assignedUntil={esc.assigned_until}
        onSubmitAttempt={() => setSubmitAttempted(true)}
      />

      <ConfirmCancelModal
        open={cancelModalOpen}
        onClose={() => setCancelModalOpen(false)}
        onConfirm={handleConfirmCancel}
        isPending={cancel.isPending}
        error={cancel.error as Error | null}
      />
    </div>
  );
}
