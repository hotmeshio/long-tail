import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuth';
import { useToast } from '../../../hooks/useToast';
import {
  useEscalation,
  useClaimEscalation,
  useResolveEscalation,
  useEscalateToRole,
} from '../../../api/escalations';
import { useTask } from '../../../api/tasks';
import { useEscalationTargets } from '../../../api/roles';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { PriorityBadge } from '../../../components/common/PriorityBadge';
import { CountdownTimer } from '../../../components/common/CountdownTimer';
import { JsonViewer } from '../../../components/common/JsonViewer';
import { PageHeader } from '../../../components/common/PageHeader';
import { SectionLabel } from '../../../components/common/SectionLabel';
import { Pill } from '../../../components/common/Pill';
import { Collapsible } from '../../../components/common/Collapsible';
import { isEffectivelyClaimed, isAvailable } from '../../../lib/escalation';
import { getResolverTemplate } from '../../../lib/templates';
import { safeParseJson } from '../../../lib/parse';
import { CLAIM_DURATION_OPTIONS } from '../../../lib/constants';
import { TimeAgo } from '../../../components/common/TimeAgo';

// ---------------------------------------------------------------------------
// Inline action panels — replace modals
// ---------------------------------------------------------------------------

function ClaimPanel({
  onClaim,
  isPending,
}: {
  onClaim: (minutes: number) => void;
  isPending: boolean;
}) {
  const [duration, setDuration] = useState('30');

  return (
    <div className="space-y-4">
      <SectionLabel>Claim Duration</SectionLabel>
      <div className="flex flex-wrap gap-2">
        {CLAIM_DURATION_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setDuration(opt.value)}
            className={`px-3 py-1.5 text-xs rounded-md border transition-colors duration-150 ${
              duration === opt.value
                ? 'border-accent bg-accent/10 text-accent font-medium'
                : 'border-surface-border text-text-secondary hover:border-accent/40'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <button
        onClick={() => onClaim(parseInt(duration))}
        disabled={isPending}
        className="btn-primary text-sm w-full"
      >
        {isPending ? 'Claiming...' : 'Claim Escalation'}
      </button>
    </div>
  );
}

function ResolvePanel({
  workflowType,
  onResolve,
  onCancel,
  isPending,
  error,
}: {
  workflowType: string | null;
  onResolve: (payload: Record<string, unknown>) => void;
  onCancel: () => void;
  isPending: boolean;
  error?: Error | null;
}) {
  const [json, setJson] = useState('{}');
  const [parseError, setParseError] = useState('');
  const [requestTriage, setRequestTriage] = useState(false);
  const [triageHint, setTriageHint] = useState('');

  useEffect(() => {
    if (workflowType) setJson(getResolverTemplate(workflowType));
  }, [workflowType]);

  const handleSubmit = () => {
    setParseError('');
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(json);
    } catch {
      setParseError('Invalid JSON');
      return;
    }
    if (requestTriage) {
      payload._lt = { needsTriage: true, ...(triageHint ? { hint: triageHint } : {}) };
    }
    onResolve(payload);
  };

  return (
    <div className="space-y-4">
      <SectionLabel>Resolver Payload</SectionLabel>
      {workflowType && (
        <p className="text-[10px] text-text-tertiary">
          Template: <span className="font-mono">{workflowType}</span>
        </p>
      )}
      <textarea
        value={json}
        onChange={(e) => setJson(e.target.value)}
        className="input font-mono text-xs"
        rows={8}
        spellCheck={false}
      />

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={requestTriage}
          onChange={(e) => setRequestTriage(e.target.checked)}
          className="w-4 h-4 rounded border-border accent-accent"
        />
        <div>
          <p className="text-xs font-medium text-text-primary">Request AI Triage</p>
          <p className="text-[10px] text-text-tertiary">Route to MCP triage orchestrator</p>
        </div>
      </label>

      <Collapsible open={requestTriage}>
        <div className="pl-7">
          <input
            type="text"
            value={triageHint}
            onChange={(e) => setTriageHint(e.target.value)}
            placeholder="e.g., image_orientation"
            className="input text-xs font-mono w-full"
          />
          <p className="text-[10px] text-text-tertiary mt-1">
            Guides the triage workflow on what remediation to apply
          </p>
        </div>
      </Collapsible>

      {parseError && <p className="text-xs text-status-error">{parseError}</p>}
      {error && <p className="text-xs text-status-error">{error.message}</p>}

      <div className="flex gap-3">
        <button onClick={handleSubmit} disabled={isPending} className="btn-primary text-xs flex-1">
          {isPending ? 'Submitting...' : requestTriage ? 'Resolve & Triage' : 'Submit Resolution'}
        </button>
        <button onClick={onCancel} className="btn-secondary text-xs">
          Cancel
        </button>
      </div>
    </div>
  );
}

function EscalatePanel({
  currentRole,
  targets,
  onEscalate,
  onCancel,
  isPending,
  error,
}: {
  currentRole: string;
  targets: string[];
  onEscalate: (role: string) => void;
  onCancel: () => void;
  isPending: boolean;
  error?: Error | null;
}) {
  const [selected, setSelected] = useState('');

  return (
    <div className="space-y-4">
      <SectionLabel>Escalate to Role</SectionLabel>
      <p className="text-xs text-text-secondary">
        Reassign from <span className="font-medium text-text-primary">{currentRole}</span> to:
      </p>
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="select w-full text-sm"
      >
        <option value="">Select a role...</option>
        {targets.map((role) => (
          <option key={role} value={role}>{role}</option>
        ))}
      </select>
      {error && <p className="text-xs text-status-error">{error.message}</p>}
      <div className="flex gap-3">
        <button
          onClick={() => onEscalate(selected)}
          disabled={!selected || isPending}
          className="btn-primary text-xs flex-1"
        >
          {isPending ? 'Escalating...' : 'Escalate'}
        </button>
        <button onClick={onCancel} className="btn-secondary text-xs">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Parent Task context
// ---------------------------------------------------------------------------

function ParentTaskContext({ taskId }: { taskId: string }) {
  const { data: task, isLoading } = useTask(taskId);

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-2">
        <div className="h-4 bg-surface-sunken rounded w-32" />
        <div className="h-4 bg-surface-sunken rounded w-48" />
      </div>
    );
  }

  if (!task) return null;

  const recentMilestones = (task.milestones ?? []).slice(-5);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <StatusBadge status={task.status} />
        <span className="text-xs font-mono text-text-secondary">{task.workflow_type}</span>
      </div>

      {task.error && (
        <div className="text-xs text-status-error bg-status-error/5 px-3 py-2 rounded-md">
          {task.error}
        </div>
      )}

      {recentMilestones.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-text-tertiary font-medium">Recent Milestones</p>
          {recentMilestones.map((m, i) => (
            <div key={i} className="flex items-baseline gap-2 text-xs">
              <span className="text-text-tertiary font-mono shrink-0">
                {m.updated_at ? new Date(m.updated_at).toLocaleTimeString() : '—'}
              </span>
              <span className="text-text-secondary">{m.name}</span>
              <span className="text-text-tertiary truncate font-mono text-[10px]">
                {typeof m.value === 'object' ? JSON.stringify(m.value) : String(m.value)}
              </span>
            </div>
          ))}
        </div>
      )}

      <Link
        to={`/workflows/tasks/${taskId}`}
        className="text-xs text-accent hover:underline inline-block"
      >
        View full task &rarr;
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

type ActivePanel = 'none' | 'resolve' | 'escalate' | 'release';

export function EscalationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { addToast } = useToast();
  const { data: esc, isLoading } = useEscalation(id!);
  const claim = useClaimEscalation();
  const resolve = useResolveEscalation();
  const escalate = useEscalateToRole();
  const { data: escalationTargets } = useEscalationTargets(esc?.role ?? '');

  const returnPath = (location.state as { from?: string } | null)?.from ?? '/escalations';
  const [activePanel, setActivePanel] = useState<ActivePanel>('none');

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-surface-sunken rounded w-48" />
        <div className="h-40 bg-surface-sunken rounded" />
      </div>
    );
  }

  if (!esc) {
    return <p className="text-sm text-text-secondary">Escalation not found.</p>;
  }
  const hasTargets = (escalationTargets?.targets?.length ?? 0) > 0;

  const available = isAvailable(esc);
  const claimed = isEffectivelyClaimed(esc);
  const claimedByMe = claimed && esc.assigned_to === user?.userId;
  const claimedByOther = claimed && !claimedByMe;

  const handleClaim = (durationMinutes: number) => {
    claim.mutate({ id: esc.id, durationMinutes });
  };

  const handleResolve = (payload: Record<string, unknown>) => {
    resolve.mutate(
      { id: esc.id, resolverPayload: payload },
      {
        onSuccess: () => {
          addToast('Escalation resolved', 'success');
          navigate(returnPath);
        },
      },
    );
  };

  const handleEscalate = (targetRole: string) => {
    if (!targetRole) return;
    escalate.mutate(
      { id: esc.id, targetRole },
      {
        onSuccess: () => {
          addToast(`Escalated to ${targetRole}`, 'success');
          navigate(returnPath);
        },
      },
    );
  };

  const handleRelease = () => {
    claim.mutate(
      { id: esc.id, durationMinutes: 0 },
      {
        onSuccess: () => {
          addToast('Escalation released', 'success');
          navigate(returnPath);
        },
      },
    );
  };

  return (
    <div>
      <PageHeader title="Escalation" backTo={returnPath} backLabel={returnPath === '/escalations/queue' ? 'My Queue' : 'Escalations'} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
        {/* ---- Left: Context ---- */}
        <div className="lg:col-span-2 space-y-0">
          {/* Identity */}
          <div className="pb-6 mb-6 border-b border-surface-border">
            <SectionLabel className="mb-3">Identity</SectionLabel>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-text-primary">{esc.type}</span>
              {esc.subtype && (
                <span className="text-xs text-text-tertiary">{esc.subtype}</span>
              )}
              <Pill>{esc.role}</Pill>
              <span className="text-xs text-text-tertiary">{esc.modality}</span>
              <span className="text-xs font-mono text-text-tertiary">{esc.workflow_type}</span>
            </div>
            <p className="text-[10px] font-mono text-text-tertiary mt-2 break-all">
              {esc.workflow_id}
            </p>
          </div>

          {/* Status */}
          <div className="pb-6 mb-6 border-b border-surface-border">
            <SectionLabel className="mb-3">Status</SectionLabel>
            <div className="flex flex-wrap items-center gap-4">
              <StatusBadge status={esc.status} />
              <PriorityBadge priority={esc.priority} />
              {claimed && (
                <span className="text-xs text-text-secondary">
                  Claimed by{' '}
                  <span className="font-mono">
                    {esc.assigned_to}
                    {claimedByMe && <span className="text-accent ml-1">(you)</span>}
                  </span>
                </span>
              )}
              {!claimed && esc.status === 'pending' && (
                <span className="text-xs text-text-tertiary">Unassigned</span>
              )}
              {claimed && esc.assigned_until && (
                <CountdownTimer until={esc.assigned_until} />
              )}
            </div>
            <p className="text-[10px] text-text-tertiary mt-2">
              Created <TimeAgo date={esc.created_at} />
            </p>
          </div>

          {/* Description */}
          {esc.description && (
            <div className="pb-6 mb-6 border-b border-surface-border">
              {(() => {
                const r = safeParseJson(esc.description);
                return r.ok && typeof r.data === 'object' && r.data !== null;
              })() ? (
                <JsonViewer data={esc.description} label="Description" />
              ) : (
                <>
                  <SectionLabel className="mb-3">Description</SectionLabel>
                  <p className="text-sm text-text-secondary leading-relaxed">{esc.description}</p>
                </>
              )}
            </div>
          )}

          {/* Parent Task */}
          {esc.task_id && (
            <div className="pb-6 mb-6 border-b border-surface-border">
              <SectionLabel className="mb-3">Parent Task</SectionLabel>
              <ParentTaskContext taskId={esc.task_id} />
            </div>
          )}

          {/* Payloads */}
          <div className="space-y-6">
            <SectionLabel>Payloads</SectionLabel>
            {esc.escalation_payload && (
              <JsonViewer data={esc.escalation_payload} label="Escalation Payload" />
            )}
            <JsonViewer data={esc.envelope} label="Original Envelope" />
            {esc.metadata && <JsonViewer data={esc.metadata} label="Metadata" />}
            {esc.resolver_payload && (
              <JsonViewer data={esc.resolver_payload} label="Resolver Payload" />
            )}
          </div>
        </div>

        {/* ---- Right: Actions ---- */}
        <div className="space-y-6">
          {/* Unclaimed — show claim panel */}
          {available && (
            <ClaimPanel onClaim={handleClaim} isPending={claim.isPending} />
          )}

          {/* Claimed by someone else */}
          {claimedByOther && (
            <div className="space-y-3">
              <SectionLabel>Claimed by Another User</SectionLabel>
              <p className="text-xs text-text-secondary font-mono">{esc.assigned_to}</p>
              {esc.assigned_until && <CountdownTimer until={esc.assigned_until} />}
            </div>
          )}

          {/* Claimed by me — command buttons */}
          {claimedByMe && esc.status === 'pending' && (
            <div className="space-y-4">
              {/* Timer */}
              {esc.assigned_until && (
                <div className="pb-4 border-b border-surface-border">
                  <SectionLabel className="mb-2">Time Remaining</SectionLabel>
                  <CountdownTimer until={esc.assigned_until} />
                </div>
              )}

              {/* Action buttons — only show when no panel is expanded */}
              {activePanel === 'none' && (
                <div className="space-y-3">
                  <button
                    onClick={() => setActivePanel('resolve')}
                    className="btn-primary text-sm w-full"
                  >
                    Resolve
                  </button>
                  {hasTargets && (
                    <button
                      onClick={() => setActivePanel('escalate')}
                      className="btn-secondary text-sm w-full"
                    >
                      Escalate
                    </button>
                  )}
                  <button
                    onClick={() => setActivePanel('release')}
                    className="btn-ghost text-sm w-full text-status-error"
                  >
                    Release
                  </button>
                </div>
              )}

              {/* Expanded panels */}
              {activePanel === 'resolve' && (
                <ResolvePanel
                  workflowType={esc.workflow_type}
                  onResolve={handleResolve}
                  onCancel={() => setActivePanel('none')}
                  isPending={resolve.isPending}
                  error={resolve.error as Error | null}
                />
              )}

              {activePanel === 'escalate' && (
                <EscalatePanel
                  currentRole={esc.role}
                  targets={escalationTargets?.targets ?? []}
                  onEscalate={handleEscalate}
                  onCancel={() => setActivePanel('none')}
                  isPending={escalate.isPending}
                  error={escalate.error as Error | null}
                />
              )}

              {activePanel === 'release' && (
                <div className="space-y-3">
                  <p className="text-sm text-text-secondary">
                    Release this escalation back to the pool?
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={handleRelease}
                      disabled={claim.isPending}
                      className="btn-primary text-xs flex-1 bg-status-error hover:bg-status-error/80"
                    >
                      {claim.isPending ? 'Releasing...' : 'Yes, Release'}
                    </button>
                    <button
                      onClick={() => setActivePanel('none')}
                      className="btn-secondary text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Resolved state */}
          {esc.status === 'resolved' && (
            <div className="space-y-3">
              <SectionLabel>Resolved</SectionLabel>
              <StatusBadge status={esc.status} />
              {esc.resolved_at && (
                <p className="text-xs text-text-tertiary">
                  <TimeAgo date={esc.resolved_at} />
                </p>
              )}
            </div>
          )}

          {/* Cancelled state */}
          {esc.status === 'cancelled' && (
            <div className="space-y-3">
              <SectionLabel>Cancelled</SectionLabel>
              <StatusBadge status={esc.status} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
