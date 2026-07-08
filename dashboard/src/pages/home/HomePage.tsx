import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Inbox, Code2, Workflow, LayoutDashboard, ExternalLink, BookOpen,
} from 'lucide-react';
import { formatCountCompact } from '../../lib/format';
import { useAvailableEscalations, useEscalations, useStationMetrics } from '../../api/escalations';
import { useRoleDetails } from '../../api/roles';
import { useJobs } from '../../api/workflows';
import { useMcpRuns } from '../../api/pipelines';
import { useControlPlaneApps } from '../../api/controlplane';
import { useAuth } from '../../hooks/useAuth';
import { useAccess } from '../../hooks/useAccess';
import { useEscalationStatsEvents, useWorkflowListEvents, useStationMetricsEvents } from '../../hooks/useEventHooks';
import { DateValue } from '../../components/common/display/DateValue';
import { RolePill } from '../../components/common/display/RolePill';
import { WorkflowPill } from '../../components/common/display/WorkflowPill';
import { ListToolbar } from '../../components/common/data/ListToolbar';
import { PaceChart, type ChartStation } from '../operations/PaceChart';
import { buildFragments } from '../operations/OperationsPage';
import { priorityQueueLink } from '../operations/priority-link';

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
        <h2 className="section-h2">{children}</h2>
        {count !== undefined && count > 0 && (
          <span className="px-1.5 py-0.5 rounded-full bg-accent/10 text-accent text-[10px] font-semibold tabular-nums">
            {formatCountCompact(count)}
          </span>
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
        <span className={`w-1.5 h-1.5 rounded-full dot-ring shrink-0 ${dot}`} />
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
  const { isBuilder, isOps } = useAccess();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: cpData } = useControlPlaneApps({ enabled: isBuilder });
  const allAppIds = useMemo(() => (cpData?.apps ?? []).map((a: any) => a.appId).sort(), [cpData]);
  const firstAppId = allAppIds[0] ?? '';
  const pipelineNs = searchParams.get('pipelinenamespace') || firstAppId;
  const durableNs = searchParams.get('durablenamespace') || firstAppId;
  const setNs = useCallback((key: string, ns: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set(key, ns);
      return next;
    }, { replace: false });
  }, [setSearchParams]);
  useEscalationStatsEvents();
  useWorkflowListEvents();
  useStationMetricsEvents();

  // Row 2: the Pace Board shows for builders (superadmin/engineer) AND ops (admin);
  // the execution columns are builder-only — admins historically cannot see
  // workflows, so their Pace Board spans the full row. Disable queries per tier
  // so roles don't fire requests they can't access (403 on control-plane apps →
  // empty namespace → 400 on jobs).
  const showPace = isBuilder || isOps;
  const rolesQ = useRoleDetails({ enabled: showPace });
  const stationQ = useStationMetrics('1h', { enabled: showPace });
  const jobsQ = useJobs({ limit: 5, sort_by: 'updated_at', order: 'desc', namespace: durableNs }, { enabled: isBuilder });
  const durableAppIds = allAppIds;
  const pipelineAppIds = allAppIds;
  const mcpQ = useMcpRuns({ limit: 5, app_id: pipelineNs, sort_by: 'updated_at', order: 'desc' }, { enabled: isBuilder });
  const allEscQ = useAvailableEscalations({ limit: 5, sort_by: 'created_at', order: 'desc' });
  const myEscQ = useEscalations({ assigned_to: user?.userId, status: 'pending', limit: 5, sort_by: 'created_at', order: 'desc' });

  // Delayed refetch — allows signal-routed escalation resolutions
  // (durable activity) time to commit before refreshing the list
  useEffect(() => {
    const timer = setTimeout(() => {
      myEscQ.refetch();
      allEscQ.refetch();
    }, 2000);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Pace Board mini — the primary sequence (longest line) at the 1h window.
  const paceStations = useMemo((): ChartStation[] => {
    const fragments = buildFragments(rolesQ.data?.roles ?? []);
    const primary = fragments[0]?.stations ?? [];
    const metrics = stationQ.data?.stations ?? [];
    return primary.map(({ role: r }) => ({
      role: r.role,
      title: r.title,
      parent_role: r.parent_role,
      target_per_hour: r.target_per_hour ?? null,
      upstream_roles: r.upstream_roles ?? [],
      metric: metrics.find((m) => m.role === r.role),
    }));
  }, [rolesQ.data, stationQ.data]);
  const paceRoleByName = useMemo(
    () => new Map((rolesQ.data?.roles ?? []).map((r) => [r.role, r])),
    [rolesQ.data],
  );

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

      {/* ── Row 1: All Escalations | My Escalations ──────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-14 min-h-[35vh]">

        {/* Col 1: All Escalations */}
        <div>
          <SectionHeader icon={Inbox} color="text-accent" count={allEscTotal} docsHash="#docs:dashboard.md:all-escalations" actions={
            <div className="flex items-center gap-2">
              <ListToolbar onRefresh={() => allEscQ.refetch()} isFetching={allEscQ.isFetching} apiPath="/escalations?status=pending&limit=5&sort_by=created_at&order=desc" />
              <NavIcon to="/escalations/available" icon={ExternalLink} title="All escalations" />
            </div>
          }>
            All Escalations
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
          <SectionHeader icon={Inbox} color="text-accent" count={myEscTotal} docsHash="#docs:dashboard.md:escalations-overview" actions={
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

      {/* ── Row 2: Pace Board | Procedural | Graph — mirrors the left nav.
          Builders see all three; ops (admin) can't see workflows, so their
          Pace Board spans the full row. Operators see neither. */}
      {showPace && <div className={`grid grid-cols-1 ${isBuilder ? 'lg:grid-cols-3' : ''} gap-x-14 mt-14`}>

        {/* Col 1: Pace Board — the story being told, at a glance */}
        <div>
          <SectionHeader icon={LayoutDashboard} color="text-accent" docsHash="#docs:dashboard.md:pace-board" actions={
            <NavIcon to="/operations" icon={ExternalLink} title="Open the Pace Board" />
          }>
            Pace Board
          </SectionHeader>
          {paceStations.length === 0 ? (
            <EmptyPanel icon={LayoutDashboard} text="No stations yet — mark roles visible in Operations" />
          ) : (
            <div className={`${isBuilder ? 'h-64' : 'h-80'} cursor-pointer`} onClick={() => navigate('/operations')}>
              <PaceChart
                stations={paceStations}
                selectedRole={null}
                onSelect={() => navigate('/operations')}
                onUpstreamSelect={() => navigate('/operations')}
                onPrioritySelect={(role) => {
                  const detail = paceRoleByName.get(role);
                  if (detail) navigate(priorityQueueLink(detail));
                }}
                periodHours={1}
              />
            </div>
          )}
        </div>

        {/* Col 2: Procedural executions (builders only) */}
        {isBuilder && <div>
          <SectionHeader icon={Code2} color="text-accent" count={jobsTotal} docsHash="#docs:dashboard.md:procedural-executions" actions={
            <div className="flex items-center gap-2">
              <ListToolbar onRefresh={() => jobsQ.refetch()} isFetching={jobsQ.isFetching} apiPath={`/workflow-states/jobs?namespace=${durableNs}&limit=5`} />
              <NavIcon to="/workflows/executions" icon={ExternalLink} title="All procedural executions" />
            </div>
          }>
            Procedural
          </SectionHeader>
          <AppPicker appIds={durableAppIds} selected={durableNs} onSelect={(ns) => setNs('durablenamespace', ns)} />
          {jobs.length === 0 ? (
            <EmptyPanel icon={Code2} text="No recent procedural runs" />
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
        </div>}

        {/* Col 3: Graph executions (builders only) */}
        {isBuilder && <div>
          <SectionHeader icon={Workflow} color="text-accent" count={mcpTotal} docsHash="#docs:dashboard.md:graph-executions" actions={
            <div className="flex items-center gap-2">
              <ListToolbar onRefresh={() => mcpQ.refetch()} isFetching={mcpQ.isFetching} apiPath={`/pipelines?app_id=${pipelineNs}&limit=5`} />
              <NavIcon to="/mcp/executions" icon={ExternalLink} title="All graph executions" />
            </div>
          }>
            Graph
          </SectionHeader>
          <AppPicker appIds={pipelineAppIds} selected={pipelineNs} onSelect={(ns) => setNs('pipelinenamespace', ns)} />
          {mcpRuns.length === 0 ? (
            <EmptyPanel icon={Workflow} text="No recent graph runs" />
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
        </div>}
      </div>}
    </div>
  );
}
