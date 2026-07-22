import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useDiscoveredWorkflows,
  useDeleteWorkflowConfig,
} from '../../../api/workflows';
import {
  Server,
  ShieldCheck, ShieldPlus, ShieldOff, Settings, Wrench, Play, UserCheck,
} from 'lucide-react';
import { FilterBar, FilterSelect, FilterInput } from '../../../components/common/data/FilterBar';
import { ConfirmDeleteModal } from '../../../components/common/modal/ConfirmDeleteModal';
import { RolePill } from '../../../components/common/display/RolePill';
import { WorkflowPill } from '../../../components/common/display/WorkflowPill';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import type { DiscoveredWorkflow } from '../../../api/types';

// ── Tier badge ─────────────────────────────────────────────────────────────────

function TierBadge({ tier }: { tier: string }) {
  if (tier === 'certified')
    return <span className="inline-flex items-center gap-1 text-2xs font-medium text-status-success"><ShieldCheck className="w-3 h-3" />Certified</span>;
  if (tier === 'registered')
    return <span className="inline-flex items-center gap-1 text-2xs font-medium text-text-secondary"><Settings className="w-3 h-3" />Registered</span>;
  return <span className="inline-flex items-center gap-1 text-2xs font-medium text-text-quaternary"><Wrench className="w-3 h-3" />Durable</span>;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function WorkflowConfigsPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useDiscoveredWorkflows();
  const deleteConfig = useDeleteWorkflowConfig();

  const [search, setSearch] = useState('');
  const [activeQueue, setActiveQueue] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const allWorkflows: DiscoveredWorkflow[] = data ?? [];

  const queues = useMemo(
    () => [...new Set(allWorkflows.map((w) => w.task_queue).filter(Boolean) as string[])].sort(),
    [allWorkflows],
  );

  const grouped = useMemo(() => {
    const q = search.toLowerCase().trim();
    const targetQueues = activeQueue ? [activeQueue] : queues;
    return targetQueues
      .map((queue) => ({
        queue,
        workflows: allWorkflows.filter(
          (w) =>
            w.task_queue === queue &&
            (!q ||
              w.workflow_type.toLowerCase().includes(q) ||
              w.description?.toLowerCase().includes(q)),
        ),
      }))
      .filter((g) => g.workflows.length > 0);
  }, [allWorkflows, queues, search, activeQueue]);

  // Workflows with no queue
  const ungrouped = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (activeQueue) return [];
    return allWorkflows.filter(
      (w) =>
        !w.task_queue &&
        (!q || w.workflow_type.toLowerCase().includes(q) || w.description?.toLowerCase().includes(q)),
    );
  }, [allWorkflows, search, activeQueue]);

  const handleRowClick = (row: DiscoveredWorkflow) => {
    if (row.registered) {
      navigate(`/workflows/registry/${encodeURIComponent(row.workflow_type)}`);
    } else {
      navigate(`/workflows/registry/new?workflow_type=${encodeURIComponent(row.workflow_type)}&task_queue=${encodeURIComponent(row.task_queue ?? '')}`);
    }
  };

  const handleDelete = () => {
    if (!confirmDelete) return;
    deleteConfig.mutate(confirmDelete, { onSuccess: () => setConfirmDelete(null) });
  };

  return (
    <div>
      <PageHeader
        title="Registered Workflows"
        docsHash="#docs:dashboard.md:workflow-registry"
        actions={
          <button onClick={() => navigate('/workflows/registry/new')} className="btn-primary text-xs">
            Register Workflow
          </button>
        }
      />

      {/* Sticky filter bar: queue select + search */}
      {!isLoading && queues.length > 0 && (
        <FilterBar>
          <FilterSelect
            label="Queue"
            value={activeQueue ?? ''}
            onChange={(v) => setActiveQueue(v || null)}
            options={queues.map((q) => ({ value: q, label: q }))}
          />
          <FilterInput
            label="Search"
            value={search}
            onChange={setSearch}
            placeholder={`${allWorkflows.length} workflows…`}
          />
        </FilterBar>
      )}

      {/* Content */}
      {isLoading ? (
        <LoadingSkeleton />
      ) : grouped.length === 0 && ungrouped.length === 0 ? (
        <p className="text-sm text-text-tertiary mt-8">
          {search || activeQueue ? 'No workflows match your filter.' : 'No workflows discovered yet.'}
        </p>
      ) : (
        <div className="space-y-10">
          {grouped.map(({ queue, workflows }) => (
            <div key={queue}>
              <div className="sticky top-[60px] z-10 bg-surface flex items-center gap-2 py-2 mb-2 border-b border-surface-border">
                <Server className="w-3 h-3 text-accent" strokeWidth={1.5} />
                <h2 className="section-h2">{queue}</h2>
                <span className="text-xs text-text-quaternary">{workflows.length}</span>
              </div>
              <WorkflowTableHeader />
              <div className="divide-y divide-surface-border/30">
                {workflows.map((wf) => (
                  <WorkflowRow
                    key={wf.workflow_type}
                    wf={wf}
                    onRowClick={handleRowClick}
                    onDelete={setConfirmDelete}
                    onNavigate={navigate}
                  />
                ))}
              </div>
            </div>
          ))}

          {ungrouped.length > 0 && (
            <div>
              <div className="sticky top-[60px] z-10 bg-surface flex items-center gap-2 py-2 mb-2 border-b border-surface-border">
                <Wrench className="w-3 h-3 text-text-quaternary" strokeWidth={1.5} />
                <h2 className="section-h2">No Queue</h2>
                <span className="text-xs text-text-quaternary">{ungrouped.length}</span>
              </div>
              <WorkflowTableHeader />
              <div className="divide-y divide-surface-border/30">
                {ungrouped.map((wf) => (
                  <WorkflowRow
                    key={wf.workflow_type}
                    wf={wf}
                    onRowClick={handleRowClick}
                    onDelete={setConfirmDelete}
                    onNavigate={navigate}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <ConfirmDeleteModal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title="Unregister Workflow"
        description={
          <>
            Delete the registration for{' '}
            <span className="font-mono font-medium text-text-primary">{confirmDelete}</span>? This
            removes its invocation settings, certification, and interceptor treatment; the workflow
            keeps running as a plain durable workflow. To demote certified → registered instead,
            open the workflow and uncheck Certify — that keeps every setting.
          </>
        }
        isPending={deleteConfig.isPending}
        error={deleteConfig.error as Error | null}
      />
    </div>
  );
}

// ── Column layout ─────────────────────────────────────────────────────────────
// [Workflow 1fr] [Tier 7rem] [Access 13rem] [Actions 4.5rem]
const ROW_GRID = 'grid grid-cols-[minmax(0,1fr)_7rem_13rem_4.5rem] gap-x-6';

function WorkflowTableHeader() {
  return (
    <div className={`${ROW_GRID} px-3 pb-2 pt-1`}>
      <span className="text-2xs font-medium text-text-quaternary">Workflow</span>
      <span className="text-2xs font-medium text-text-quaternary">Tier</span>
      <span className="text-2xs font-medium text-text-quaternary">Access</span>
      <span />
    </div>
  );
}

// ── Workflow row ───────────────────────────────────────────────────────────────

function WorkflowRow({
  wf,
  onRowClick,
  onDelete,
  onNavigate,
}: {
  wf: DiscoveredWorkflow;
  onRowClick: (wf: DiscoveredWorkflow) => void;
  onDelete: (type: string) => void;
  onNavigate: (path: string) => void;
}) {
  const escRoles = wf.roles ?? [];
  const invokeRoles = wf.invocation_roles ?? [];

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onRowClick(wf)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onRowClick(wf); }}
      className={`group ${ROW_GRID} py-2 px-3 -mx-3 rounded-md cursor-pointer transition-colors items-center`}
    >
      {/* Col 1: Workflow name + description, single line */}
      <div className="flex items-center gap-3 min-w-0">
        <WorkflowPill
          type={wf.workflow_type}
          size="md"
          variant={wf.tier === 'certified' ? 'certified' : wf.tier === 'registered' ? 'registered' : 'durable'}
        />
        {wf.description && (
          <p className="flex-1 min-w-0 truncate text-2xs text-text-tertiary group-hover:text-text-secondary transition-colors">
            {wf.description}
          </p>
        )}
      </div>

      {/* Col 2: Tier */}
      <div>
        <TierBadge tier={wf.tier ?? 'durable'} />
      </div>

      {/* Col 3: Access — escalation + invocation roles, single line */}
      <div className="flex items-center gap-1.5 min-w-0 overflow-hidden whitespace-nowrap">
        {escRoles.length > 0 && (
          <>
            <span title="Escalation roles"><ShieldCheck className="w-3 h-3 text-text-quaternary shrink-0" /></span>
            {escRoles.map((r) => <RolePill key={`e-${r}`} role={r} />)}
          </>
        )}
        {invokeRoles.length > 0 && (
          <>
            <span title="Invocation roles"><UserCheck className="w-3 h-3 text-text-quaternary shrink-0" /></span>
            {invokeRoles.map((r) => <RolePill key={`i-${r}`} role={r} />)}
          </>
        )}
        {escRoles.length === 0 && invokeRoles.length === 0 && (
          <span className="text-xs text-text-quaternary">—</span>
        )}
      </div>

      {/* Col 4: Actions — revealed on hover */}
      <div className="flex items-center justify-end gap-2.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {wf.invocable && (
          <button
            title="Invoke workflow"
            onClick={(e) => { e.stopPropagation(); onNavigate(`/workflows/start?type=${encodeURIComponent(wf.workflow_type)}&mode=now`); }}
            className="text-text-quaternary hover:text-status-success transition-colors"
          >
            <Play className="w-3.5 h-3.5" />
          </button>
        )}
        {wf.tier === 'durable' && (
          <button
            title="Configure workflow"
            onClick={(e) => { e.stopPropagation(); onNavigate(`/workflows/registry/new?workflow_type=${encodeURIComponent(wf.workflow_type)}&task_queue=${encodeURIComponent(wf.task_queue ?? '')}`); }}
            className="text-text-quaternary hover:text-status-info transition-colors"
          >
            <Wrench className="w-3.5 h-3.5" />
          </button>
        )}
        {wf.tier === 'registered' && (
          <button
            title="Certify workflow"
            onClick={(e) => { e.stopPropagation(); onNavigate(`/workflows/registry/${encodeURIComponent(wf.workflow_type)}`); }}
            className="text-text-quaternary hover:text-status-success transition-colors"
          >
            <ShieldPlus className="w-3.5 h-3.5" />
          </button>
        )}
        {wf.registered && (
          <button
            title="Unregister workflow"
            onClick={(e) => { e.stopPropagation(); onDelete(wf.workflow_type); }}
            className="text-text-quaternary hover:text-status-warning transition-colors"
          >
            <ShieldOff className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Loading skeleton ───────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-8 mt-4">
      {[1, 2].map((i) => (
        <div key={i}>
          <div className="h-4 bg-surface-sunken rounded w-36 mb-4" />
          <div className="space-y-4">
            {[1, 2, 3].map((j) => (
              <div key={j} className="space-y-1.5">
                <div className="h-3 bg-surface-sunken rounded w-48" />
                <div className="h-3 bg-surface-sunken rounded w-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
