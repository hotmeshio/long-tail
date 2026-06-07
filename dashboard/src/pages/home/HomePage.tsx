import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Inbox, ScrollText, GitBranch, Layers, ExternalLink, BookOpen,
} from 'lucide-react';
import { useAvailableEscalations, useEscalations } from '../../api/escalations';
import { useJobs } from '../../api/workflows';
import { useMcpRuns } from '../../api/pipelines';
import { useControlPlaneApps } from '../../api/controlplane';
import { useProcesses } from '../../api/tasks';
import { useAuth } from '../../hooks/useAuth';
import { useAccess } from '../../hooks/useAccess';
import { useEscalationStatsEvents, useWorkflowListEvents, useProcessListEvents } from '../../hooks/useEventHooks';
import { DateValue } from '../../components/common/display/DateValue';
import { RolePill } from '../../components/common/display/RolePill';
import { WorkflowPill } from '../../components/common/display/WorkflowPill';
import { ListToolbar } from '../../components/common/data/ListToolbar';

const STATUS_DOT: Record<string, string> = {
  completed: 'bg-status-success',
  active: 'bg-status-active',
  running: 'bg-status-active',
  pending: 'bg-status-pending',
  error: 'bg-status-error',
  failed: 'bg-status-error',
};
function statusDotClass(status: string): string {
  return STATUS_DOT[status] ?? 'bg-text-tertiary';
}

// ── Section header ──────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, color, docsHash, count, children, actions }: { icon: React.ElementType; color?: string; docsHash?: string; count?: number; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-4 pb-2 border-b border-surface-border">
      <div className="flex items-center gap-2">
        <Icon className={`w-4.5 h-4.5 ${color || 'text-accent/60'}`} strokeWidth={1.5} />
        <h2 className="text-sm font-semibold uppercase tracking-widest text-accent/80">{children}</h2>
        {count !== undefined && count > 0 && (
          <span className="text-[10px] text-text-quaternary tabular-nums">{count}</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {docsHash && (
          <button onClick={() => { window.location.hash = docsHash; }} className="text-text-quaternary hover:text-accent transition-colors" title="Docs">
            <BookOpen className="w-2.5 h-2.5" strokeWidth={1.5} />
          </button>
        )}
        {actions}
      </div>
    </div>
  );
}

function EmptyPanel({ icon: Icon, text }: { icon: React.ElementType; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <Icon className="w-6 h-6 text-text-quaternary/50 mb-2" strokeWidth={1} />
      <p className="text-xs text-text-quaternary">{text}</p>
    </div>
  );
}

/** Middle-ellipsis: keep first N and last N chars with ... in between */
function midEllipsis(s: string, maxLen = 37): string {
  if (!s || s.length <= maxLen) return s;
  const keep = Math.floor((maxLen - 3) / 2);
  return `${s.slice(0, keep)}...${s.slice(-keep)}`;
}

/** Consistent row for all execution lists in row 1 */
function ExecutionRow({ dot, pill, id, date, onClick }: {
  dot: string;
  pill: React.ReactNode;
  id: string;
  date: string;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="w-full text-left hover:bg-surface-hover/50 rounded-md px-1 py-1.5 transition-colors">
      <div className="flex items-center gap-2 mb-0.5">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
        <span className="text-[12px] text-text-primary font-mono truncate max-w-[60%]">{midEllipsis(id)}</span>
        <span className="text-[10px] text-text-quaternary shrink-0 ml-auto whitespace-nowrap"><DateValue date={date} /></span>
      </div>
      <div className="pl-3.5 flex items-center gap-1 overflow-hidden">{pill}</div>
    </button>
  );
}

function NavIcon({ to, icon: Icon, title }: { to: string; icon: React.ElementType; title: string }) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(to)}
      className="text-text-quaternary hover:text-accent transition-colors"
      title={title}
    >
      <Icon className="w-2.5 h-2.5" strokeWidth={1.5} />
    </button>
  );
}

// ── Namespace Picker ────────────────────────────────────────────────────────

function AppPicker({ appIds, selected, onSelect }: {
  appIds: string[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (appIds.length <= 1) return null;

  return (
    <div className="relative mb-3 -mt-2" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
      >
        {selected}
        <svg className={`w-2.5 h-2.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-surface-raised border border-surface-border rounded-md shadow-lg z-30 py-1 min-w-[120px]">
          {appIds.map((id) => (
            <button
              key={id}
              onClick={() => { onSelect(id); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-[11px] transition-colors ${
                selected === id ? 'text-accent bg-accent/5' : 'text-text-secondary hover:bg-surface-hover'
              }`}
            >
              {id}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function HomePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isBuilder } = useAccess();
  const [searchParams, setSearchParams] = useSearchParams();
  const pipelineNs = searchParams.get('pipelinenamespace') || 'hmsh';
  const durableNs = searchParams.get('durablenamespace') || 'durable';
  const setNs = useCallback((key: string, ns: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set(key, ns);
      return next;
    }, { replace: false });
  }, [setSearchParams]);
  useEscalationStatsEvents();
  useWorkflowListEvents();
  useProcessListEvents();

  const procQ = useProcesses({ limit: 5 });
  const jobsQ = useJobs({ limit: 5, sort_by: 'updated_at', order: 'desc', namespace: durableNs });
  const { data: cpData } = useControlPlaneApps();
  const allAppIds = (cpData?.apps ?? []).map((a: any) => a.appId);
  const durableAppIds = allAppIds;
  const pipelineAppIds = allAppIds;
  const mcpQ = useMcpRuns({ limit: 5, app_id: pipelineNs, sort_by: 'updated_at', order: 'desc' });
  const allEscQ = useAvailableEscalations({ limit: 5, sort_by: 'created_at', order: 'desc' });
  const myEscQ = useEscalations({ assigned_to: user?.userId, status: 'pending', limit: 5, sort_by: 'created_at', order: 'desc' });
  const processes = procQ.data?.processes ?? [];
  const processTotal = (procQ.data as any)?.total as number | undefined;
  const jobs = jobsQ.data?.jobs ?? [];
  const jobsTotal = jobsQ.data?.total;
  const mcpRuns = (mcpQ.data as any)?.jobs ?? [];
  const mcpTotal = (mcpQ.data as any)?.total as number | undefined;
  const allEscalations = allEscQ.data?.escalations ?? [];
  const allEscTotal = allEscQ.data?.total;
  const myEscalations = myEscQ.data?.escalations ?? [];
  const myEscTotal = myEscQ.data?.total;

  return (
    <div>
      <h1 className="text-3xl font-light text-text-primary mb-10">Recent Activity</h1>

      {/* ── Row 1: Available Escalations | My Escalations ────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-14">

        {/* Col 1: Available Escalations */}
        <div>
          <SectionHeader icon={Inbox} color="text-blue-400" count={allEscTotal} docsHash="#docs:dashboard.md:all-escalations" actions={
            <div className="flex items-center gap-2">
              <ListToolbar onRefresh={() => allEscQ.refetch()} isFetching={allEscQ.isFetching} apiPath="/escalations?status=pending&limit=5&sort_by=created_at&order=desc" />
              <NavIcon to="/escalations/available" icon={ExternalLink} title="All available escalations" />
            </div>
          }>
            Available Escalations
          </SectionHeader>
          {allEscalations.length === 0 ? (
            <EmptyPanel icon={Inbox} text="No pending escalations" />
          ) : (
            <div className="space-y-1">
              {allEscalations.map((esc: any) => (
                <button
                  key={esc.id}
                  onClick={() => navigate(`/escalations/detail/${esc.id}`)}
                  className="w-full text-left hover:bg-surface-hover/50 rounded-md px-1 py-1.5 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[9px] text-text-quaternary font-medium shrink-0">P{esc.priority ?? 2}</span>
                    <span className="text-[12px] text-text-primary truncate flex-1 max-w-[65%]">{esc.description || esc.subtype || esc.type}</span>
                    <span className="text-[10px] text-text-quaternary shrink-0 ml-auto"><DateValue date={esc.updated_at ?? esc.created_at} /></span>
                  </div>
                  <div className="flex items-center gap-2 pl-5">
                    <WorkflowPill type={esc.type || 'unknown'} size="xs" />
                    <span className="flex-1" />
                    <RolePill role={esc.role} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Col 2: My Escalations */}
        <div>
          <SectionHeader icon={Inbox} color="text-orange-400" count={myEscTotal} docsHash="#docs:dashboard.md:escalations-overview" actions={
            <div className="flex items-center gap-2">
              <ListToolbar onRefresh={() => myEscQ.refetch()} isFetching={myEscQ.isFetching} apiPath={`/escalations?assigned_to=${user?.userId ?? ''}&status=pending&limit=5&sort_by=created_at&order=desc`} />
              <NavIcon to="/escalations/queue" icon={ExternalLink} title="My escalation queue" />
            </div>
          }>
            My Escalations
          </SectionHeader>
          {myEscalations.length === 0 ? (
            <EmptyPanel icon={Inbox} text="No assigned escalations" />
          ) : (
            <div className="space-y-1">
              {myEscalations.map((esc: any) => (
                <button
                  key={esc.id}
                  onClick={() => navigate(`/escalations/detail/${esc.id}`)}
                  className="w-full text-left hover:bg-surface-hover/50 rounded-md px-1 py-1.5 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[9px] text-text-quaternary font-medium shrink-0">P{esc.priority ?? 2}</span>
                    <span className="text-[12px] text-text-primary truncate flex-1 max-w-[65%]">{esc.description || esc.subtype || esc.type}</span>
                    <span className="text-[10px] text-text-quaternary shrink-0 ml-auto"><DateValue date={esc.updated_at ?? esc.created_at} /></span>
                  </div>
                  <div className="flex items-center gap-2 pl-5">
                    <WorkflowPill type={esc.type || 'unknown'} size="xs" />
                    <span className="flex-1" />
                    <RolePill role={esc.role} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Row 2: Processes | Durable Executions | Pipeline Executions (builders only) */}
      {isBuilder && <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-14 mt-14">

        {/* Col 1: Processes */}
        <div>
          <SectionHeader icon={Layers} color="text-emerald-400" count={processTotal} docsHash="#docs:dashboard.md:processes-overview" actions={
            <div className="flex items-center gap-2">
              <ListToolbar onRefresh={() => procQ.refetch()} isFetching={procQ.isFetching} apiPath="/tasks/processes?limit=5" />
              <NavIcon to="/processes/all" icon={ExternalLink} title="All processes" />
            </div>
          }>
            Certified Processes
          </SectionHeader>
          <div className="mb-3 -mt-2">
            <span className="px-2 py-0.5 text-[10px] rounded text-text-quaternary uppercase tracking-widest">all namespaces</span>
          </div>
          {processes.length === 0 ? (
            <EmptyPanel icon={Layers} text="No recent processes" />
          ) : (
            <div className="space-y-1">
              {processes.map((p: any) => (
                <ExecutionRow
                  key={p.origin_id}
                  dot={(p.task_count ?? 0) > 0 && (p.completed ?? 0) >= (p.task_count ?? 0) ? 'bg-status-success' : (p.escalated ?? 0) > 0 ? 'border border-status-error' : 'bg-status-active'}
                  pill={<>{(p.workflow_types ?? [p.workflow_type]).filter(Boolean).map((wt: string) => <WorkflowPill key={wt} type={wt} size="xs" />)}</>}
                  id={p.origin_id}
                  date={p.last_activity ?? p.started_at}
                  onClick={() => navigate(`/processes/detail/${p.origin_id}`)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Col 2: Durable Executions */}
        <div>
          <SectionHeader icon={ScrollText} color="text-blue-400" count={jobsTotal} docsHash="#docs:dashboard.md:durable-executions" actions={
            <div className="flex items-center gap-2">
              <ListToolbar onRefresh={() => jobsQ.refetch()} isFetching={jobsQ.isFetching} apiPath={`/workflow-states/jobs?namespace=${durableNs}&limit=5`} />
              <NavIcon to="/workflows/executions" icon={ExternalLink} title="All durable executions" />
            </div>
          }>
            Durable Executions
          </SectionHeader>
          <AppPicker appIds={durableAppIds} selected={durableNs} onSelect={(ns) => setNs('durablenamespace', ns)} />
          {jobs.length === 0 ? (
            <EmptyPanel icon={ScrollText} text="No recent executions" />
          ) : (
            <div className="space-y-1">
              {jobs.map((job: any) => (
                <ExecutionRow
                  key={job.workflow_id}
                  dot={statusDotClass(job.status)}
                  pill={<WorkflowPill type={job.entity || job.type || 'workflow'} size="xs" />}
                  id={job.workflow_id}
                  date={job.updated_at ?? job.created_at}
                  onClick={() => navigate(`/workflows/executions/${job.workflow_id}`)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Col 3: Pipeline Executions */}
        <div>
          <SectionHeader icon={GitBranch} color="text-violet-400" count={mcpTotal} docsHash="#docs:dashboard.md:mcp-pipeline-tools" actions={
            <div className="flex items-center gap-2">
              <ListToolbar onRefresh={() => mcpQ.refetch()} isFetching={mcpQ.isFetching} apiPath={`/pipelines?app_id=${pipelineNs}&limit=5`} />
              <NavIcon to="/mcp/executions" icon={ExternalLink} title="All pipeline executions" />
            </div>
          }>
            Pipeline Executions
          </SectionHeader>
          <AppPicker appIds={pipelineAppIds} selected={pipelineNs} onSelect={(ns) => setNs('pipelinenamespace', ns)} />
          {mcpRuns.length === 0 ? (
            <EmptyPanel icon={GitBranch} text="No recent pipeline runs" />
          ) : (
            <div className="space-y-1">
              {mcpRuns.map((run: any) => (
                <ExecutionRow
                  key={run.workflow_id}
                  dot={statusDotClass(run.status)}
                  pill={<WorkflowPill type={run.entity || run.workflow_name || 'pipeline'} variant="pipeline" size="xs" />}
                  id={run.workflow_id}
                  date={run.updated_at ?? run.created_at}
                  onClick={() => navigate(`/mcp/executions/${run.workflow_id}?namespace=${pipelineNs}`)}
                />
              ))}
            </div>
          )}
        </div>
      </div>}
    </div>
  );
}
