import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuth';
import { useToast } from '../../../hooks/useToast';
import {
  useEscalation,
  useClaimEscalation,
  useResolveEscalation,
  useEscalateToRole,
} from '../../../api/escalations';
import { useEscalationTargets } from '../../../api/roles';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { CountdownTimer } from '../../../components/common/CountdownTimer';
import { JsonViewer } from '../../../components/common/JsonViewer';
import { PageHeader } from '../../../components/common/PageHeader';
import { CollapsibleSection } from '../../../components/common/CollapsibleSection';
import { Collapsible } from '../../../components/common/Collapsible';
import { isEffectivelyClaimed } from '../../../lib/escalation';
import { useWorkflowConfigs } from '../../../api/workflows';
import { TimeAgo } from '../../../components/common/TimeAgo';
import { useSettings } from '../../../api/settings';
import { useEscalationDetailEvents } from '../../../hooks/useNatsEvents';
import { CopyableId } from '../../../components/common/CopyableId';
import { UserName } from '../../../components/common/UserName';
import { TriageContext } from '../../../components/escalation/TriageContext';
import { ResolverForm } from '../../../components/escalation/ResolverForm';
import { EscalationActionBar } from './EscalationActionBar';
import type { ActionBarMode, ActiveView } from './EscalationActionBar';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function middleEllipsis(text: string, max: number): string {
  if (text.length <= max) return text;
  const keep = Math.floor((max - 1) / 2);
  return `${text.slice(0, keep)}…${text.slice(text.length - keep)}`;
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
  const location = useLocation();
  const { addToast } = useToast();
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
  const returnPath = (location.state as { from?: string } | null)?.from ?? '/escalations/available';
  const [showDetails, setShowDetails] = useState(false);
  const [activeView, setActiveView] = useState<ActiveView>('resolve');
  const [json, setJson] = useState('{}');

  // Section collapse state
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ context: false });
  const toggleSection = (key: string) =>
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));

  const [resolverView, setResolverView] = useState<'form' | 'json'>('form');
  const resolverSchema = wfConfig?.resolver_schema ?? null;
  useEffect(() => {
    setJson(resolverSchema ? JSON.stringify(resolverSchema, null, 2) : '{}');
  }, [resolverSchema]);

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

  const handleResolve = async (payload: Record<string, unknown>) => {
    await resolve.mutateAsync({ id: esc.id, resolverPayload: payload });
    addToast('Escalation resolved', 'success');
    navigate(returnPath);
  };

  const handleEscalate = async (targetRole: string) => {
    if (!targetRole) return;
    await escalate.mutateAsync({ id: esc.id, targetRole });
    addToast(`Escalated to ${targetRole}`, 'success');
    navigate(returnPath);
  };

  const handleRelease = async () => {
    await claim.mutateAsync({ id: esc.id, durationMinutes: 0 });
    addToast('Escalation released', 'success');
    navigate(returnPath);
  };

  return (
    <div className="min-h-[calc(100vh-9rem)] flex flex-col">
      <PageHeader title="Escalation" />

      {/* Hero */}
      <h2
        className="text-2xl font-medium text-text-primary leading-snug whitespace-nowrap overflow-hidden"
        title={esc.description || `${esc.type} escalation`}
      >
        {middleEllipsis(esc.description || `${esc.type} escalation`, 72)}
      </h2>
      <div className="flex flex-wrap items-center gap-2 mt-3 text-xs">
        <StatusBadge status={esc.status} />
        {esc.resolved_at ? (
          <span className="text-text-tertiary">
            <TimeAgo date={esc.resolved_at} />
          </span>
        ) : (
          <span className="text-text-tertiary">
            <TimeAgo date={esc.created_at} />
          </span>
        )}
        {esc.assigned_to && (
          <span className="text-text-secondary">
            by{' '}
            <span className="font-medium text-text-primary">
              {claimedByMe ? 'you' : <UserName userId={esc.assigned_to} />}
            </span>
          </span>
        )}

        {claimed && !isTerminal && esc.assigned_until && (
          <>
            <span className="text-text-quaternary">&middot;</span>
            <CountdownTimer until={esc.assigned_until} />
          </>
        )}

        <span className="text-text-quaternary">&middot;</span>
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center gap-1 text-text-tertiary hover:text-accent transition-colors"
        >
          Details
          <svg
            className={`w-3 h-3 transition-transform duration-200 ${showDetails ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Details — copyable IDs */}
      <Collapsible open={showDetails}>
        <div className="mt-4 bg-surface-raised border border-surface-border rounded-md p-4 flex flex-wrap gap-x-8 gap-y-4">
          <div className="text-left">
            <span className="text-[11px] font-medium text-text-secondary uppercase tracking-wide">Priority</span>
            <p className="text-[12px] text-text-primary mt-0.5">P{esc.priority}</p>
          </div>
          <div className="text-left">
            <span className="text-[11px] font-medium text-text-secondary uppercase tracking-wide">Role</span>
            <p className="text-[12px] text-text-primary mt-0.5">{esc.role}</p>
          </div>
          <CopyableId label="Escalation ID" value={esc.id} />
          {esc.task_id && (
            <CopyableId label="Task" value={esc.task_id} href={`/workflows/tasks/detail/${esc.task_id}`} />
          )}
          <CopyableId label="Workflow" value={esc.workflow_type} />
          <CopyableId label="Workflow ID" value={esc.workflow_id} />
          <CopyableId label="Task Queue" value={esc.task_queue} />
          {esc.origin_id && esc.origin_id !== esc.workflow_id && (
            <CopyableId label="Origin" value={esc.origin_id} />
          )}
          {esc.trace_id && (
            <CopyableId
              label="Trace"
              value={esc.trace_id}
              href={traceUrl ? traceUrl.replace('{traceId}', esc.trace_id) : undefined}
              external
            />
          )}
        </div>
      </Collapsible>

      {/* Collapsible sections — matching WorkflowExecutionPage pattern */}
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
        {!isTerminal && claimedByMe && activeView === 'resolve' && esc.workflow_type && (
          <CollapsibleSection
            title="Submit Your Resolution"
            sectionKey="resolver"
            isCollapsed={!!collapsed.resolver}
            onToggle={toggleSection}
            contentClassName="mt-4 ml-9"
          >
            <div className="flex justify-end mb-3">
              <button
                onClick={() => setResolverView(resolverView === 'form' ? 'json' : 'form')}
                className="text-[10px] text-text-tertiary hover:text-accent transition-colors"
              >
                {resolverView === 'form' ? 'Raw JSON' : 'Form'}
              </button>
            </div>
            {resolverView === 'form' ? (
              <ResolverForm value={json} onChange={setJson} />
            ) : (
              <textarea
                value={json}
                onChange={(e) => setJson(e.target.value)}
                className="input font-mono text-xs w-full"
                rows={8}
                spellCheck={false}
                data-testid="resolve-json"
              />
            )}
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
