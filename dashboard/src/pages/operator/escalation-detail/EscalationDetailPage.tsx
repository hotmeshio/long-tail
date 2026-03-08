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
import { PriorityBadge } from '../../../components/common/PriorityBadge';
import { CountdownTimer } from '../../../components/common/CountdownTimer';
import { JsonViewer } from '../../../components/common/JsonViewer';
import { PageHeader } from '../../../components/common/PageHeader';
import { Pill } from '../../../components/common/Pill';
import { Collapsible } from '../../../components/common/Collapsible';
import { isEffectivelyClaimed } from '../../../lib/escalation';
import { useWorkflowConfigs } from '../../../api/workflows';
import { TimeAgo } from '../../../components/common/TimeAgo';
import { useSettings } from '../../../api/settings';
import { useEscalationDetailEvents } from '../../../hooks/useNatsEvents';
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
// Copyable mono value
// ---------------------------------------------------------------------------

function CopyableId({ label, value, href, external }: { label: string; value: string | null | undefined; href?: string; external?: boolean }) {
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();
  if (!value) return null;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleNavigate = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!href) return;
    if (external) {
      window.open(href, '_blank', 'noopener,noreferrer');
    } else {
      navigate(href);
    }
  };

  return (
    <div className="text-left group relative">
      <span className="text-[11px] font-medium text-text-secondary uppercase tracking-wide">{label}</span>
      <span className="flex items-center gap-1 mt-0.5">
        <button
          onClick={handleCopy}
          title={`Copy ${label}`}
          className="text-[12px] font-mono text-text-primary group-hover:text-accent transition-colors truncate max-w-[280px]"
        >
          {value}
        </button>
        <button onClick={handleCopy} title="Copy" className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-0.5">
          <svg className={`w-3 h-3 transition-colors ${copied ? 'text-status-success' : 'text-text-tertiary hover:text-text-primary'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            {copied
              ? <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              : <path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3" />
            }
          </svg>
        </button>
        {href && (
          <button onClick={handleNavigate} title={`View ${label}`} className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-0.5">
            <svg className="w-3 h-3 text-text-tertiary hover:text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101M10.172 13.828a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
          </button>
        )}
      </span>
    </div>
  );
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
  const [showContext, setShowContext] = useState<boolean | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>('resolve');
  const [json, setJson] = useState('{}');

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

  // Input/Output expanded when terminal or not claimed by me (context-first); collapsed when acting
  const contextOpen = showContext ?? (isTerminal || !claimedByMe);

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
      <div className="flex flex-wrap items-center gap-3 mt-3">
        <StatusBadge status={esc.status} />
        <PriorityBadge priority={esc.priority} />
        <Pill>{esc.role}</Pill>
        <span className="text-xs text-text-tertiary"><TimeAgo date={esc.created_at} /></span>
        {esc.resolved_at && (
          <span className="text-xs text-text-tertiary">
            Resolved <TimeAgo date={esc.resolved_at} />
          </span>
        )}
        {claimed && (
          <span className="text-xs font-mono text-text-secondary">
            {esc.assigned_to?.slice(0, 8)}...
            {claimedByMe && <span className="text-accent ml-1 font-sans">(you)</span>}
          </span>
        )}
        {claimed && esc.assigned_until && (
          <CountdownTimer until={esc.assigned_until} />
        )}
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center gap-1 text-xs text-text-tertiary hover:text-accent transition-colors"
        >
          Details
          <svg
            className={`w-3 h-3 transition-transform duration-200 ${showDetails ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <button
          onClick={() => setShowContext(!contextOpen)}
          className="flex items-center gap-1 text-xs text-text-tertiary hover:text-accent transition-colors"
        >
          Input/Output
          <svg
            className={`w-3 h-3 transition-transform duration-200 ${contextOpen ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Details — copyable IDs */}
      <Collapsible open={showDetails}>
        <div className="mt-4 bg-surface-raised border border-surface-border rounded-md p-4 flex flex-wrap gap-x-8 gap-y-4">
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

      {/* Input/Output — collapsed when claimed */}
      <Collapsible open={contextOpen}>
        <div className="mt-4 space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {esc.envelope && (
              <div>
                <JsonViewer data={esc.envelope} label="Input Envelope" />
              </div>
            )}
            {escalationPayload != null && (
              <div>
                <JsonViewer data={escalationPayload} label="Workflow Result" />
              </div>
            )}
          </div>

          {resolverPayload != null && (
            <div className="max-w-xl">
              <JsonViewer data={resolverPayload} label="Resolver Payload" />
            </div>
          )}
        </div>
      </Collapsible>

      {/* Resolver JSON input — in viewport when resolving */}
      {!isTerminal && claimedByMe && activeView === 'resolve' && esc.workflow_type && (
        <div className="mt-6">
          <textarea
            value={json}
            onChange={(e) => setJson(e.target.value)}
            className="input font-mono text-xs w-full"
            rows={6}
            spellCheck={false}
            data-testid="resolve-json"
          />
        </div>
      )}

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
