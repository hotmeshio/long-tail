import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../hooks/useAuth';
import { useAccess } from '../../../hooks/useAccess';
import { useActingIdentity } from '../../../hooks/useActingIdentity';
import { useScanEnabled } from '../../../hooks/useScanInput';
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
import { ScanConfirmModal } from '../../../components/scan/ScanConfirmModal';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { ListToolbar } from '../../../components/common/data/ListToolbar';
import { isEffectivelyClaimed } from '../../../lib/escalation';
import { mapPayloadToForm } from '../../../lib/x-lt-bind';
import { useWorkflowConfigs } from '../../../api/workflows';
import { useSettings } from '../../../api/settings';
import { getAiOverride } from '../../../lib/view-as';
import { useEscalationDetailEvents } from '../../../hooks/useEventHooks';
import { PanelRightClose, PanelRightOpen, RotateCcw, X } from 'lucide-react';
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
import { readTransitionConfig, readTransitionDone } from '../../../lib/x-lt-transition';
import { readSubmitOnClaim } from '../../../lib/x-lt-submit-on-claim';
import { readFooterLabels } from '../../../lib/x-lt-labels';
import { readSubmitGuard } from '../../../lib/x-lt-submit-guard';
import { useSubmitGuard } from '../../../hooks/useSubmitGuard';
import { buildResolverPayload } from '../../../lib/resolver-payload';
import { interpolateHelp } from '../../../lib/x-lt-help';
import { TransitionWaitModal } from '../../../components/escalation/TransitionWaitModal';
import { apiFetch } from '../../../api/client';

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
  // The detail route reuses this element across navigations to other
  // escalations (same route pattern, different :id). Keying the view by id
  // tears down and rebuilds ALL local state — the seeded form json, the
  // one-shot init ref, submit flags — so nothing rendered for one escalation
  // can survive into, or act on, another.
  const { id } = useParams<{ id: string }>();
  return <EscalationDetailView key={id} id={id!} />;
}

function EscalationDetailView({ id }: { id: string }) {
  const { user } = useAuth();
  const { identity: acting } = useActingIdentity();
  const scanEnabled = useScanEnabled();
  // The badge grant outranks the session: whoever badged in owns the claim
  // comparisons here, and the mutations they fire ride the acting header so
  // the server attributes them to the same person.
  const effectiveActorId = acting?.actorId ?? user?.userId;
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { data: esc, isLoading, refetch, isFetching } = useEscalation(id);
  useEscalationDetailEvents(id);
  const claim = useClaimEscalation();
  const resolve = useResolveEscalation();
  const escalate = useEscalateToRole();
  const cancel = useCancelEscalation();
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
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
  // Bumped on every click on the locked (unclaimed) form; each bump replays
  // the claim button's wiggle — the answer to "why can't I type here."
  const [claimNudge, setClaimNudge] = useState(0);
  const [panelActiveView, setPanelActiveView] = useState<string | undefined>(undefined);
  // Set after a successful resolve when the form opted into a hand-off
  // (x-lt-transition). Holds the screen on a wait modal instead of returning to
  // the list; the global useFollowMyClaims navigates to the born-assigned
  // follow-on when its `claimed` event arrives. The timeout below is the
  // fallback for the SDK's at-most-once delivery (a dropped event); `doneDest`
  // is where to land if the follow-on never comes (an x-lt-transition-done URL).
  const [waiting, setWaiting] = useState<{ message: string; maxWaitSeconds: number; doneDest: string | null } | null>(null);

  // Auto-start (list-driven claim-and-submit): a list row launched with the
  // `autoStart` intent (x-lt-row-action submitOnClaim) claims and submits this
  // escalation without a second gesture, then transitions on to the follow-on.
  // `autoStarting` masks the brief form render with the wait screen; the ref
  // holds the latest handler (assigned in the render body, where the handlers
  // are defined) so the effect below can fire it exactly once.
  const [autoStarting, setAutoStarting] = useState(false);
  const autoStartFiredRef = useRef(false);
  const autoStartActionRef = useRef<(() => void) | null>(null);

  // Auto-resolve-when-empty (x-lt-submit-guard.autoResolveWhenEmpty): the moment
  // the guard query is confirmed empty, the claimed parent submits itself. Fires
  // once; the effect re-checks on page-load and after each inline child-resolve
  // (the guard query is socket-invalidated, so it refetches with no polling).
  const autoResolveFiredRef = useRef(false);
  const autoResolveActionRef = useRef<(() => void) | null>(null);

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

  // Footer configuration — root tokens on the form schema. `x-lt-submit-on-claim`
  // folds claim and submit into one gesture; `x-lt-labels` renames the action
  // controls (e.g. a "Claim and Submit" button when both are set).
  const submitOnClaim = readSubmitOnClaim(effectiveSchema as Record<string, unknown> | null);
  const footerLabels = readFooterLabels(effectiveSchema as Record<string, unknown> | null);

  // x-lt-submit-guard — the query precondition. The page owns it (not the action
  // bar) because it also drives auto-resolve-when-empty. Inert until the row
  // loads; the hook self-disables when the schema declares no guard.
  const submitGuardDef = readSubmitGuard(effectiveSchema as Record<string, unknown> | null);
  const submitGuard = useSubmitGuard(submitGuardDef, esc ? buildShowIfContext(esc) : undefined);

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

  // Hand-off fallback. The follow-on's `claimed` event normally arrives and
  // useFollowMyClaims navigates (this view unmounts, clearing the timer). SDK
  // delivery is at-most-once, so if that event was dropped, on timeout we query
  // the child of this escalation assigned to the viewer — precise, no heuristic
  // — and land on it; only if none exists do we return to the list.
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          parent_id: id,
          assigned_to: effectiveActorId ?? '',
          status: 'pending',
          limit: '1',
        });
        const res = await apiFetch<{ escalations: Array<{ id: string; parent_id?: string }> }>(`/escalations?${params}`);
        const child = res?.escalations?.[0];
        // Guard the correlation on the row itself, so a query path that does not
        // filter by parent_id (self-scope search) can never land a wrong child.
        if (child?.id && child.parent_id === id) {
          setWaiting(null);
          navigate(`/escalations/detail/${child.id}`);
          return;
        }
      } catch { /* fall through to the declared destination / previous page */ }
      setWaiting(null);
      queryClient.resetQueries({ queryKey: ['escalations'] });
      queryClient.resetQueries({ queryKey: ['escalationStats'] });
      // No follow-on arrived: prefer the form's declared destination over
      // history.back() (which is wrong for a page reached via a transition).
      const dest = waiting.doneDest;
      if (dest) {
        if (dest.startsWith('/')) navigate(dest);
        else window.location.assign(dest);
      } else {
        navigate(-1);
      }
    }, waiting.maxWaitSeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [waiting, id, effectiveActorId, navigate, queryClient]);

  // Fire the list-driven auto-start once. The escalation must be loaded, still
  // claimable (pending, no live claim), and — when it carries a form — seeded so
  // its defaults are ready to submit. The one-shot ref survives refetches; the
  // action ref holds the current handler closure (assigned in the render body,
  // after the handlers are defined).
  useEffect(() => {
    if (autoStartFiredRef.current) return;
    if (!(location.state as { autoStart?: boolean } | null)?.autoStart) return;
    if (!esc || esc.status !== 'pending' || isEffectivelyClaimed(esc)) return;
    // The seeded defaults land in `json` one render after the schema resolves;
    // an unseeded '{}' would submit an empty payload, so wait for the real form.
    if (json === '{}') return;
    autoStartFiredRef.current = true;
    autoStartActionRef.current?.();
  }, [esc, json, location.state]);

  // Auto-resolve the claimed parent once the submit guard confirms its children
  // are gone. Only the claimant closes it, and only when the parent's own form
  // has seeded — the action ref (below) revalidates before submitting.
  useEffect(() => {
    if (autoResolveFiredRef.current) return;
    if (!submitGuardDef?.autoResolveWhenEmpty || !submitGuard.confirmedEmpty) return;
    if (!esc || esc.status !== 'pending' || !isEffectivelyClaimed(esc)) return;
    if (esc.assigned_to !== effectiveActorId) return;
    if (json === '{}') return;
    autoResolveFiredRef.current = true;
    autoResolveActionRef.current?.();
  }, [submitGuard.confirmedEmpty, submitGuardDef, esc, json, effectiveActorId]);

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
  const claimedByMe = claimed && esc.assigned_to === effectiveActorId;
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

  // Every mutation below targets the mount-fixed route id, never esc.id.
  // The two are equal for the life of this keyed view, but binding to the
  // prop makes it impossible for an in-flight render against refreshed
  // query data to redirect an action at a different escalation.
  const handleClaim = (durationMinutes: number) => {
    claim.mutate({ id, durationMinutes });
  };

  const goBack = () => {
    queryClient.resetQueries({ queryKey: ['escalations'] });
    queryClient.resetQueries({ queryKey: ['escalationStats'] });
    navigate(-1);
  };

  // The declared x-lt-transition-done destination for this form, interpolated
  // against the escalation context ({{metadata.account}} etc.), or null.
  const resolveDoneDest = (): string | null => {
    const tmpl = readTransitionDone(effectiveSchema as Record<string, unknown> | null);
    if (!tmpl) return null;
    return interpolateHelp(tmpl, buildShowIfContext(esc)) || null;
  };

  // Navigate to a resolved destination — internal path in-app, else external —
  // refreshing the queue caches first (as goBack does).
  const navigateDone = (dest: string) => {
    queryClient.resetQueries({ queryKey: ['escalations'] });
    queryClient.resetQueries({ queryKey: ['escalationStats'] });
    if (dest.startsWith('/')) navigate(dest);
    else window.location.assign(dest);
  };

  const handleResolve = async (payload: Record<string, unknown>) => {
    try {
      await resolve.mutateAsync({ id, resolverPayload: payload });
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
    clearDraft(id);
    // Hand-off resolution, in order:
    //  1. x-lt-transition → hold on the wait screen while the born-assigned
    //     follow-on is prepared (doneDest is where to land if it never comes).
    //  2. x-lt-transition-done → an explicit destination. A terminal chain step
    //     was reached by a forward navigation, so history.back() is wrong; go
    //     where the form says (a canonical page or a rich worklist URL).
    //  3. neither → return to the previous page.
    const transition = readTransitionConfig(effectiveSchema as Record<string, unknown> | null);
    const doneDest = resolveDoneDest();
    if (transition) {
      setWaiting({ ...transition, doneDest });
      return;
    }
    if (doneDest) {
      navigateDone(doneDest);
      return;
    }
    goBack();
  };

  // x-lt-submit-on-claim: claim, then immediately resolve with whatever the form
  // holds (its seeded defaults). The two are distinct operations — the row must
  // be claimed by me before the server accepts the resolve — so they run in
  // sequence. If the defaults fail validation the claim still stands; the page
  // drops into the normal claimed state with the errors surfaced so the person
  // finishes by hand. Wired to the Claim button only; extend and the locked-form
  // nudge keep the plain claim.
  const handleClaimAndSubmit = async (durationMinutes: number) => {
    try {
      await claim.mutateAsync({ id, durationMinutes });
    } catch {
      return; // claim.error surfaces through the action bar
    }
    // A submit guard defers the auto-submit: land the person on the claimed
    // parent with its children to work; the auto-resolve effect closes it once
    // they clear (pair submitOnClaim with autoResolveWhenEmpty for full flow).
    if (submitGuard.blocked) return;
    const result = buildResolverPayload(json, buildShowIfContext(esc));
    if (result.parseError) return; // seeded form is malformed — leave it claimed
    if (result.errors.length > 0) {
      setSubmitAttempted(true);
      setFormErrors(result.errors);
      setSidePanelOpen(true);
      savePanelOpen(true);
      setPanelActiveView(ESCALATION_PANEL_VIEWS.ERRORS);
      return;
    }
    await handleResolve(result.payload!);
  };

  // The list-driven auto-start: mask the form with the wait screen, then run the
  // same claim-and-submit the manual button runs. On success the transition (or
  // goBack) takes over; on a validation miss the mask drops to reveal the
  // claimed form and its errors. Reassigned each render so the pre-return effect
  // fires the latest closure.
  autoStartActionRef.current = async () => {
    const dm = (location.state as { durationMinutes?: number } | null)?.durationMinutes;
    setAutoStarting(true);
    await handleClaimAndSubmit(typeof dm === 'number' && dm > 0 ? dm : 30);
    setAutoStarting(false);
  };

  // Auto-resolve-when-empty: submit the parent's seeded payload once the guard
  // clears. Revalidates first — if the parent's own form is incomplete, leave it
  // for the person rather than auto-closing an invalid record.
  autoResolveActionRef.current = () => {
    const result = buildResolverPayload(json, buildShowIfContext(esc));
    if (result.parseError || result.errors.length > 0) return;
    handleResolve(result.payload!);
  };

  const handleEscalate = async (targetRole: string) => {
    if (!targetRole) return;
    await escalate.mutateAsync({ id, targetRole });
    goBack();
  };

  const handleRetryTriage = async () => {
    if (!claimedByMe) {
      await claim.mutateAsync({ id, durationMinutes: 30 });
    }
    const diagnosis = (payloadObj?.diagnosis as string) || esc.description || '';
    await resolve.mutateAsync({
      id,
      resolverPayload: { _lt: { needsTriage: true }, notes: diagnosis },
    });
    goBack();
  };

  const handleRelease = async () => {
    await claim.mutateAsync({ id, durationMinutes: 0 });
    goBack();
  };

  const handleConfirmCancel = async () => {
    await cancel.mutateAsync(id);
    clearDraft(id);
    setCancelModalOpen(false);
    goBack();
  };

  // One panel entry in the header: the toggle. Authored help stays reachable
  // through the form title's help icon and the panel's own Help tab.
  const headerActions = (
    <div className="flex items-center gap-2">
      <ListToolbar
        onRefresh={() => refetch()}
        isFetching={isFetching}
        apiPath={`/escalations/${esc.id}`}
        standalone
      />
      <button
        onClick={() => setSidePanelOpen((prev) => { savePanelOpen(!prev); return !prev; })}
        className="ml-2 text-accent/60 hover:text-accent transition-colors"
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
                  label: footerLabels.release ?? 'Release',
                  hoverClass: 'hover:text-accent',
                  icon: <RotateCcw className="w-4 h-4" strokeWidth={1.5} />,
                },
                ...(footerLabels.cancel === false ? [] : [{
                  onClick: () => setCancelModalOpen(true),
                  disabled: false,
                  label: footerLabels.cancel ?? 'Cancel',
                  hoverClass: 'hover:text-status-error',
                  icon: <X className="w-4 h-4" strokeWidth={1.5} />,
                }]),
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
                onDisabledClick={() => setClaimNudge((n) => n + 1)}
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
          onClaim={submitOnClaim ? handleClaimAndSubmit : handleClaim}
          claimPending={claim.isPending || (submitOnClaim && resolve.isPending)}
          claimNudge={claimNudge}
          workflowType={esc.workflow_type}
          json={json}
          onResolve={handleResolve}
          resolvePending={resolve.isPending || resolve.isSuccess}
          resolveError={resolve.error as Error | null}
          requestTriage={requestTriage}
          triageNotes={triageNotes}
          onRelease={handleRelease}
          releasePending={claim.isPending}
          onCancel={() => setCancelModalOpen(true)}
          assignedTo={esc.assigned_to}
          assignedUntil={esc.assigned_until}
          actingName={acting && claimedByMe ? acting.displayName : null}
          badgePrompt={scanEnabled && !acting && claimedByOther}
          onSubmitAttempt={() => setSubmitAttempted(true)}
          onValidationErrors={(errors) => {
            setFormErrors(errors);
            setSidePanelOpen(true);
            savePanelOpen(true);
            setPanelActiveView(ESCALATION_PANEL_VIEWS.ERRORS);
          }}
          labels={footerLabels}
          submitBlocked={submitGuard.blocked}
          submitBlockedMessage={submitGuard.message}
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
        actionLabel={typeof footerLabels.cancel === 'string' ? footerLabels.cancel : undefined}
      />

      {/* Scan hand-off: a scanned confirm-step lands here with the pending
          action in route state; the modal asks the rule's prompt. */}
      <ScanConfirmModal escalationId={id} />

      {/* Transition hand-off: shown after a resolve on an x-lt-transition form,
          bridging the brief gap until the born-assigned follow-on arrives. */}
      <TransitionWaitModal
        open={!!waiting || autoStarting}
        message={waiting?.message
          ?? readTransitionConfig(effectiveSchema as Record<string, unknown> | null)?.message
          ?? 'Starting…'}
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
