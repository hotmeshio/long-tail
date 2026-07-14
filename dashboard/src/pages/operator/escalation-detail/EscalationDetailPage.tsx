import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../hooks/useAuth';
import { useAccess } from '../../../hooks/useAccess';
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
import { ListToolbar } from '../../../components/common/data/ListToolbar';
import { isEffectivelyClaimed } from '../../../lib/escalation';
import { mapPayloadToForm } from '../../../lib/x-lt-bind';
import { useWorkflowConfigs } from '../../../api/workflows';
import { useSettings } from '../../../api/settings';
import { useEscalationDetailEvents } from '../../../hooks/useEventHooks';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { EscalationSidePanel } from '../../../components/escalation/EscalationSidePanel';
import { EscalationActionBar } from './EscalationActionBar';
import type { ActionBarMode, ActiveView } from './EscalationActionBar';
import { EscalationContextBlocks, EscalationFormSection } from './EscalationDetailSections';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PANEL_OPEN_KEY = 'lt:escalation:panel:open';

function readPanelOpen(): boolean {
  try {
    const v = localStorage.getItem(PANEL_OPEN_KEY);
    return v === null ? true : v === 'true';
  } catch {
    return true;
  }
}

function savePanelOpen(open: boolean): void {
  try { localStorage.setItem(PANEL_OPEN_KEY, String(open)); } catch {}
}

function safeParse(value: string | null | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
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
  const { data: settings } = useSettings();

  const { isBuilder } = useAccess();

  const wfConfig = workflowConfigs?.find((c) => c.workflow_type === esc?.workflow_type);
  const traceUrl = settings?.telemetry?.traceUrl ?? null;
  const [activeView, setActiveView] = useState<ActiveView>('resolve');
  const [json, setJson] = useState('{}');

  const [sidePanelOpen, setSidePanelOpen] = useState<boolean>(readPanelOpen);

  const [requestTriage, setRequestTriage] = useState(false);
  const [triageNotes, setTriageNotes] = useState('');
  const [submitAttempted, setSubmitAttempted] = useState(false);
  // Schema resolution, most specific first:
  //   1. metadata.form_schema — a full form embedded on the row (legacy records)
  //   2. esc.form_schema — the role's form the single-escalation GET already
  //      JOINed in, resolved to the row's pinned version (metadata.schema_version)
  //      or the role's latest when unpinned. No second call.
  //   3. workflow-level resolver_schema (legacy fallback)
  const metadataFormSchema = (esc?.metadata as any)?.form_schema ?? null;
  const resolverSchema =
    (esc?.form_schema ?? wfConfig?.resolver_schema ?? null) as Record<string, any> | null;
  const effectiveSchema = metadataFormSchema ?? resolverSchema;

  // Initialize json from the form exactly once. Each field is seeded from the
  // workflow's `envelope.formDefaults` (a resolver-shaped payload, reverse-mapped
  // through x-lt-bind to the flat form) and falls back to the field's schema
  // default. So workflow-sent defaults prefill; schema defaults fill the rest.
  // Subsequent esc refetches (claim events, real-time updates) must NOT reset
  // user edits. The form arrives embedded on esc, so nothing else to await.
  const jsonInitialized = useRef(false);
  useEffect(() => {
    if (jsonInitialized.current) return;
    const formSchema = metadataFormSchema ?? (resolverSchema?.properties ? resolverSchema : null);
    if (formSchema?.properties) {
      jsonInitialized.current = true;
      const seeded = safeParse(esc?.envelope) as Record<string, any> | null;
      const seededDefaults = seeded?.formDefaults;
      const prefill = seededDefaults && typeof seededDefaults === 'object'
        ? mapPayloadToForm(seededDefaults as Record<string, any>, formSchema)
        : {};
      const initial: Record<string, any> = { _form_schema: formSchema };
      for (const [key, def] of Object.entries(formSchema.properties)) {
        const fieldDef = def as Record<string, any>;
        initial[key] = prefill[key] ?? fieldDef.default ?? '';
      }
      setJson(JSON.stringify(initial, null, 2));
    } else if (effectiveSchema) {
      jsonInitialized.current = true;
      setJson(JSON.stringify(effectiveSchema, null, 2));
    }
  }, [effectiveSchema, metadataFormSchema, resolverSchema, esc?.envelope]);

  const isRoundsExhausted = esc?.subtype === 'rounds_exhausted';

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
  const resolverObj = (typeof resolverPayload === 'object' && resolverPayload !== null && !Array.isArray(resolverPayload))
    ? resolverPayload as Record<string, unknown>
    : null;

  const actionBarMode: ActionBarMode = isTerminal
    ? 'terminal'
    : claimedByMe
      ? 'claimed_by_me'
      : claimedByOther
        ? 'claimed_by_other'
        : 'available';

  const handleClaim = (durationMinutes: number) => {
    claim.mutate({ id: esc.id, durationMinutes });
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

  const headerActions = (
    <div className="flex items-center gap-2">
      <ListToolbar
        onRefresh={() => refetch()}
        isFetching={isFetching}
        apiPath={`/escalations/${esc.id}`}
      />
      <button
        onClick={() => setSidePanelOpen((prev) => { savePanelOpen(!prev); return !prev; })}
        className="ml-2 text-text-tertiary hover:text-accent transition-colors"
        title={sidePanelOpen ? 'Hide side panel' : 'Show side panel'}
      >
        {sidePanelOpen
          ? <PanelRightClose className="w-5 h-5" strokeWidth={1.5} />
          : <PanelRightOpen className="w-5 h-5" strokeWidth={1.5} />}
      </button>
    </div>
  );

  return (
    // Two fixed-height columns, like the left nav: the form column scrolls
    // independently and the side panel keeps its own scroll. Negative margins
    // let the panel span the full middle row (header to event feed, flush
    // right); the left column re-adds those gutters for its own content.
    <div className="flex-1 min-h-0 min-w-0 flex items-stretch -mt-10 -mr-10 -mb-16">
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {/* The description IS the title — the page opens with what to do. It
            shares the row with the toolbar and panel toggle, truncating to
            make room. */}
        <div className="shrink-0 pt-10 pr-10">
          <PageHeader title={esc.description || 'Escalation'} actions={headerActions} />
        </div>

        {/* Independently scrolling form column */}
        <div className="flex-1 min-h-0 overflow-y-auto pr-10">
          <EscalationContextBlocks
            isRoundsExhausted={isRoundsExhausted}
            payloadObj={payloadObj}
            isTerminal={isTerminal}
            resolverPayload={resolverPayload as Record<string, unknown> | null}
            onRetryTriage={handleRetryTriage}
            isRetrying={claim.isPending || resolve.isPending}
          />

          <EscalationFormSection
            esc={esc}
            resolverPayload={resolverPayload}
            isTerminal={isTerminal}
            claimedByMe={claimedByMe}
            activeView={activeView}
            metadataFormSchema={metadataFormSchema}
            effectiveSchema={effectiveSchema as Record<string, unknown> | null}
            json={json}
            onJsonChange={setJson}
            requestTriage={requestTriage}
            onRequestTriageChange={setRequestTriage}
            triageNotes={triageNotes}
            onTriageNotesChange={setTriageNotes}
            onResolve={handleResolve}
            onEscalate={handleEscalate}
            submitAttempted={submitAttempted}
            isCertified={isCertified}
            hasAI={hasAI}
          />

          <div className="h-10" />
        </div>

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
      </div>

      <EscalationSidePanel
        esc={esc}
        schema={effectiveSchema as Record<string, unknown> | null}
        envelope={envelopeObj}
        payload={payloadObj}
        resolver={resolverObj}
        triage={triageData ?? null}
        hasAI={hasAI}
        claimed={claimed}
        claimedByMe={claimedByMe}
        isTerminal={isTerminal}
        isBuilder={isBuilder}
        traceUrl={traceUrl}
        open={sidePanelOpen}
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
