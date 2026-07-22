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
import { ApiError } from '../../../api/client';
import { isValidationErrorBody } from '../../../lib/validation';
import { ConfirmCancelModal } from '../../../components/common/modal/ConfirmCancelModal';
import { useEscalationTargets } from '../../../api/roles';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { ListToolbar } from '../../../components/common/data/ListToolbar';
import { isEffectivelyClaimed } from '../../../lib/escalation';
import { mapPayloadToForm } from '../../../lib/x-lt-bind';
import { useWorkflowConfigs } from '../../../api/workflows';
import { useSettings } from '../../../api/settings';
import { getAiOverride } from '../../../lib/view-as';
import { useEscalationDetailEvents } from '../../../hooks/useEventHooks';
import { HelpCircle, PanelRightClose, PanelRightOpen, RotateCcw, X } from 'lucide-react';
import { EscalationSidePanel, ESCALATION_PANEL_VIEWS } from '../../../components/escalation/EscalationSidePanel';
import { EscalationActionBar } from './EscalationActionBar';
import type { ActionBarMode, ActiveView } from './EscalationActionBar';
import type { FieldError } from '../../../lib/field-validator';
import { validateResolverForm } from '../../../lib/field-validator';
import { EscalationContextBlocks, EscalationFormSection, expandViewportSrc, buildShowIfContext } from './EscalationDetailSections';
import { IframeViewport } from '../../../components/escalation/IframeViewport';
import { ClaimExpiryModal } from './ClaimExpiryModal';
import { useClaimClock } from '../../../hooks/useClaimClock';
import { readDraft, saveDraft, clearDraft } from '../../../lib/draft-store';

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
  const [formErrors, setFormErrors] = useState<FieldError[]>([]);
  const [panelActiveView, setPanelActiveView] = useState<string | undefined>(undefined);

  // Claim clock: re-renders at the warning threshold (extend prompt) and at
  // expiry (isEffectivelyClaimed flips false on that render — the form locks
  // and the action bar returns to its available state). Dismissal is keyed by
  // the assigned_until value so an ignored prompt stays away for that claim
  // window but returns after an extension starts a new one.
  const claimClock = useClaimClock(esc?.assigned_until);
  const [extendDismissedUntil, setExtendDismissedUntil] = useState<string | null>(null);

  // Recompute form errors in real-time once the user has attempted a submit.
  // This keeps the errors sidebar in sync as the user fixes (or breaks) fields.
  useEffect(() => {
    if (!submitAttempted || !esc) return;
    try {
      const payload = JSON.parse(json) as Record<string, unknown>;
      const schema = payload._form_schema as Record<string, unknown> | undefined;
      if (!schema) { setFormErrors([]); return; }
      setFormErrors(validateResolverForm(schema, payload, buildShowIfContext(esc)));
    } catch { /* leave errors unchanged on parse failure */ }
  }, [json, submitAttempted, esc]);
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

  // Initialize json from the form exactly once. Fields are seeded in priority order:
  // metadata (facts stamped at enqueue) → envelope.formDefaults (workflow overrides)
  // → schema default. formDefaults always wins over metadata so the workflow can
  // override a metadata fact when needed. Subsequent esc refetches must NOT reset
  // user edits. The form arrives embedded on esc, so nothing else to await.
  const jsonInitialized = useRef(false);
  const initialJsonRef = useRef<string | null>(null);
  useEffect(() => {
    if (jsonInitialized.current) return;
    const formSchema = metadataFormSchema ?? (resolverSchema?.properties ? resolverSchema : null);
    if (formSchema?.properties) {
      jsonInitialized.current = true;
      const seeded = safeParse(esc?.envelope) as Record<string, any> | null;
      const formDefaults = seeded?.formDefaults;
      const mergedPrefill: Record<string, any> = {
        ...(esc?.metadata ?? {}),
        ...(typeof formDefaults === 'object' && formDefaults !== null ? formDefaults : {}),
      };
      const prefill = mapPayloadToForm(mergedPrefill, formSchema);
      const initial: Record<string, any> = { _form_schema: formSchema };
      for (const [key, def] of Object.entries(formSchema.properties)) {
        const fieldDef = def as Record<string, any>;
        // The zero value follows the declared type: an object field (e.g. a
        // checklist) starts as {} — never '' — so its value round-trips as
        // an object from the first interaction.
        const zero = fieldDef.type === 'object' ? {} : '';
        initial[key] = prefill[key] ?? fieldDef.default ?? zero;
      }
      initialJsonRef.current = JSON.stringify(initial, null, 2);
      // A saved draft (typed input from an earlier visit or a lapsed claim)
      // wins over the seeded defaults. The schema is always taken fresh —
      // a draft never resurrects a stale form definition.
      const terminal = esc?.status === 'resolved' || esc?.status === 'cancelled';
      const draft = !terminal && esc?.id ? readDraft(esc.id) : null;
      const draftObj = draft ? (safeParse(draft) as Record<string, any> | null) : null;
      if (draftObj && typeof draftObj === 'object' && !Array.isArray(draftObj)) {
        setJson(JSON.stringify({ ...draftObj, _form_schema: formSchema }, null, 2));
      } else {
        setJson(initialJsonRef.current);
      }
    } else if (effectiveSchema) {
      jsonInitialized.current = true;
      setJson(JSON.stringify(effectiveSchema, null, 2));
    }
  }, [effectiveSchema, metadataFormSchema, resolverSchema, esc?.envelope, esc?.metadata, esc?.id, esc?.status]);

  // Persist edits as a local draft (debounced). Best-effort insurance against
  // a lapsed claim or accidental navigation. Pristine defaults are not saved,
  // and reverting to them removes the stored draft; a terminal outcome
  // through this client clears it too (see handleResolve / handleConfirmCancel).
  useEffect(() => {
    if (!jsonInitialized.current || initialJsonRef.current === null || !esc?.id) return;
    if (esc.status !== 'pending') return;
    const escalationId = esc.id;
    const timer = window.setTimeout(() => {
      if (json === initialJsonRef.current) clearDraft(escalationId);
      else saveDraft(escalationId, json);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [json, esc?.id, esc?.status]);

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

  const iframeViewport = (effectiveSchema as any)?.['x-lt-viewport'] as { type?: string; src?: string } | undefined;
  const isIframeMode = iframeViewport?.type === 'iframe' && !!iframeViewport?.src && claimedByMe && !isTerminal;

  const escalationPayload = safeParse(esc.escalation_payload);
  const resolverPayload = safeParse(esc.resolver_payload);
  const envelopeObj = safeParse(esc.envelope) as Record<string, any> | null;
  const isCertified = !!(envelopeObj?.metadata?.certified);
  const aiOverride = getAiOverride();
  const hasAI = aiOverride !== null ? aiOverride : !!(settings as any)?.ai?.enabled;

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
    try {
      await resolve.mutateAsync({ id: esc.id, resolverPayload: payload });
    } catch (err) {
      // Server-side schema enforcement (enforce_schema roles) — the 422 body
      // carries the same field-error list the pre-submission pass produces;
      // route it into the same errors panel.
      if (err instanceof ApiError && isValidationErrorBody(err.body)) {
        setSubmitAttempted(true);
        setFormErrors(err.body.violations);
        setPanelActiveView(ESCALATION_PANEL_VIEWS.ERRORS);
        return;
      }
      throw err;
    }
    clearDraft(esc.id);
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
    clearDraft(esc.id);
    setCancelModalOpen(false);
    goBack();
  };

  const hasAuthoredHelp =
    typeof (effectiveSchema as Record<string, unknown> | null)?.['x-lt-help'] === 'string' ||
    typeof (effectiveSchema as Record<string, unknown> | null)?.['x-lt-context'] === 'string';

  const headerActions = (
    <div className="flex items-center gap-2">
      {hasAuthoredHelp && (
        <button
          onClick={() => {
            setSidePanelOpen(true);
            savePanelOpen(true);
            setPanelActiveView(ESCALATION_PANEL_VIEWS.HELP);
          }}
          className="text-text-tertiary hover:text-accent transition-colors"
          title="Open instructions"
        >
          <HelpCircle className="w-5 h-5" strokeWidth={1.5} />
        </button>
      )}
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
    <div className="flex-1 min-h-0 min-w-0 flex items-stretch -mt-8 -mr-page-x -mb-16">
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {isIframeMode ? (
          // Full-bleed iframe mode: no header, no padding, -ml-page-x cancels the shell gutter.
          // Release, Cancel, and panel toggle float at top-right over the iframe.
          <div className="relative flex-1 min-h-0 -ml-page-x">
            <div className="absolute top-3 right-3 z-50 flex items-center gap-0.5 bg-surface/90 backdrop-blur-sm rounded-lg px-1.5 py-1 shadow-sm border border-surface-border/40">
              {[
                {
                  onClick: handleRelease,
                  disabled: claim.isPending,
                  label: 'Release',
                  hoverClass: 'hover:text-accent',
                  icon: <RotateCcw className="w-4 h-4" strokeWidth={1.5} />,
                },
                {
                  onClick: () => setCancelModalOpen(true),
                  disabled: false,
                  label: 'Cancel',
                  hoverClass: 'hover:text-status-error',
                  icon: <X className="w-4 h-4" strokeWidth={1.5} />,
                },
                {
                  onClick: () => setSidePanelOpen((prev) => { savePanelOpen(!prev); return !prev; }),
                  disabled: false,
                  label: sidePanelOpen ? 'Hide panel' : 'Show panel',
                  hoverClass: 'hover:text-accent',
                  icon: sidePanelOpen
                    ? <PanelRightClose className="w-4 h-4" strokeWidth={1.5} />
                    : <PanelRightOpen className="w-4 h-4" strokeWidth={1.5} />,
                },
              ].map(({ onClick, disabled, label, hoverClass, icon }) => (
                <div key={label} className="relative group/tip">
                  <button
                    onClick={onClick}
                    disabled={disabled}
                    className={`text-text-tertiary ${hoverClass} transition-colors disabled:opacity-40 disabled:cursor-default p-1.5 rounded-md`}
                  >
                    {icon}
                  </button>
                  <span className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-0.5 rounded text-2xs bg-surface-sunken text-text-primary whitespace-nowrap opacity-0 group-hover/tip:opacity-100 transition-opacity">
                    {label}
                  </span>
                </div>
              ))}
            </div>
            <IframeViewport
              src={expandViewportSrc(iframeViewport!.src!, esc)}
              escalation={esc}
              schema={effectiveSchema!}
              onResolve={handleResolve}
              onEscalate={handleEscalate}
              submitAttempted={submitAttempted}
              fill
            />
          </div>
        ) : (
          <>
            {/* The description IS the title — the page opens with what to do. It
                shares the row with the toolbar and panel toggle, truncating to
                make room. */}
            <div className="shrink-0 pt-8 pr-page-x">
              <PageHeader title={esc.description || 'Escalation'} actions={headerActions} />
            </div>

            {/* Independently scrolling form column */}
            <div className="flex-1 min-h-0 overflow-y-auto pr-page-x">
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
                onClaim={() => handleClaim(30)}
                submitAttempted={submitAttempted}
                isCertified={isCertified}
                hasAI={hasAI}
                onOpenHelp={() => {
                  setSidePanelOpen(true);
                  savePanelOpen(true);
                  setPanelActiveView(ESCALATION_PANEL_VIEWS.HELP);
                }}
              />

              <div className="h-10" />
            </div>
          </>
        )}

        {!isIframeMode && <EscalationActionBar
          escalationContext={buildShowIfContext(esc)}
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
          onValidationErrors={(errors) => {
            setFormErrors(errors);
            setSidePanelOpen(true);
            savePanelOpen(true);
            setPanelActiveView(ESCALATION_PANEL_VIEWS.ERRORS);
          }}
        />}
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
        noGutter={isIframeMode}
        formErrors={formErrors}
        activePanel={panelActiveView}
        onPanelChange={setPanelActiveView}
      />

      <ConfirmCancelModal
        open={cancelModalOpen}
        onClose={() => setCancelModalOpen(false)}
        onConfirm={handleConfirmCancel}
        isPending={cancel.isPending}
        error={cancel.error as Error | null}
      />

      {claimedByMe && !isTerminal && esc.assigned_until && (
        <ClaimExpiryModal
          open={claimClock.expiringSoon && esc.assigned_until !== extendDismissedUntil}
          assignedUntil={esc.assigned_until}
          onClose={() => setExtendDismissedUntil(esc.assigned_until ?? null)}
          onExtend={handleClaim}
          isPending={claim.isPending}
        />
      )}
    </div>
  );
}
