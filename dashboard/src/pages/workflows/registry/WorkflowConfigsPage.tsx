import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useDiscoveredWorkflows,
  useDeleteWorkflowConfig,
} from '../../../api/workflows';
import { ShieldCheck, ShieldPlus, ShieldOff, Settings, Wrench, Play, UserCheck } from 'lucide-react';
import { DataTable, type Column } from '../../../components/common/data/DataTable';
import { ConfirmDeleteModal } from '../../../components/common/modal/ConfirmDeleteModal';
import { FilterBar, FilterSelect } from '../../../components/common/data/FilterBar';
import { RowAction, RowActionGroup } from '../../../components/common/layout/RowActions';
import { useFilterParams } from '../../../hooks/useFilterParams';
import type { DiscoveredWorkflow } from '../../../api/types';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { RolePill } from '../../../components/common/display/RolePill';
import { TaskQueuePill } from '../../../components/common/display/TaskQueuePill';
import { WorkflowPill } from '../../../components/common/display/WorkflowPill';

// ── Helpers ───────────────────────────────────────────────────────────────────

function matchesSearch(wf: DiscoveredWorkflow, search: string): boolean {
  const q = search.toLowerCase();
  return (
    wf.workflow_type.toLowerCase().includes(q) ||
    (wf.description ?? '').toLowerCase().includes(q)
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function WorkflowConfigsPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useDiscoveredWorkflows();
  const deleteConfig = useDeleteWorkflowConfig();
  const { filters, setFilter } = useFilterParams({
    filters: { search: '', queue: '', role: '', tier: '' },
  });

  const [searchInput, setSearchInput] = useState(filters.search);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Debounce search input
  useEffect(() => {
    if (searchInput === filters.search) return;
    const timer = setTimeout(() => setFilter('search', searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput, setFilter, filters.search]);

  const allWorkflows = data ?? [];

  // Derive facet options from data
  const queues = useMemo(
    () => [...new Set(allWorkflows.map((w) => w.task_queue).filter(Boolean) as string[])].sort(),
    [allWorkflows],
  );
  const roles = useMemo(
    () => [...new Set(allWorkflows.flatMap((w) => w.roles ?? []))].sort(),
    [allWorkflows],
  );

  // Apply client-side filters
  const workflows = useMemo(() => {
    let result = allWorkflows;
    if (filters.search) result = result.filter((w) => matchesSearch(w, filters.search));
    if (filters.queue) result = result.filter((w) => w.task_queue === filters.queue);
    if (filters.role) result = result.filter((w) => (w.roles ?? []).includes(filters.role));
    if (filters.tier) result = result.filter((w) => w.tier === filters.tier);
    return result;
  }, [allWorkflows, filters]);

  const columns: Column<DiscoveredWorkflow>[] = [
    {
      key: 'workflow_type',
      label: 'Workflow',
      className: 'max-w-xs',
      render: (row) => (
        <div className="min-w-0">
          <WorkflowPill type={row.workflow_type} size="md" variant={row.tier === 'certified' ? 'certified' : row.tier === 'configured' ? 'configured' : 'durable'} />
          {row.description && (
            <p className="text-[10px] leading-tight text-text-quaternary mt-0.5">{row.description}</p>
          )}
        </div>
      ),
    },
    {
      key: 'task_queue',
      label: 'Queue',
      render: (row) => row.task_queue ? <TaskQueuePill queue={row.task_queue} /> : <span className="text-xs text-text-tertiary">—</span>,
      className: 'whitespace-nowrap',
    },
    {
      key: 'tier',
      label: 'Tier',
      render: (row) => {
        if (row.tier === 'certified') return <span className="inline-flex items-center gap-1 text-[10px] font-medium text-text-secondary"><ShieldCheck className="w-3 h-3" />Certified</span>;
        if (row.tier === 'configured') return <span className="inline-flex items-center gap-1 text-[10px] font-medium text-text-secondary"><Settings className="w-3 h-3" />Configured</span>;
        return <span className="inline-flex items-center gap-1 text-[10px] font-medium text-text-secondary"><Wrench className="w-3 h-3" />Durable</span>;
      },
      className: 'whitespace-nowrap',
    },
    {
      key: 'roles',
      label: 'Access',
      render: (row) => {
        if (!row.registered) return <span className="text-xs text-text-tertiary">—</span>;
        const escRoles = row.roles ?? [];
        const invokeRoles = row.invocation_roles ?? [];
        if (!escRoles.length && !invokeRoles.length) return <span className="text-xs text-text-tertiary">—</span>;
        return (
          <div className="space-y-1.5">
            {escRoles.length > 0 && (
              <div className="flex items-start gap-1.5">
                <span title="Escalation roles" className="mt-0.5"><ShieldCheck className="w-3 h-3 text-text-quaternary" /></span>
                <div className="flex gap-1 flex-wrap">{escRoles.map((r) => <RolePill key={`e-${r}`} role={r} />)}</div>
              </div>
            )}
            {invokeRoles.length > 0 && (
              <div className="flex items-start gap-1.5">
                <span title="Invocation roles" className="mt-0.5"><UserCheck className="w-3 h-3 text-text-quaternary" /></span>
                <div className="flex gap-1 flex-wrap">{invokeRoles.map((r) => <RolePill key={`i-${r}`} role={r} />)}</div>
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'actions',
      label: '',
      render: (row) => (
        <RowActionGroup>
          {row.invocable && (
            <RowAction
              icon={Play}
              title="Invoke workflow"
              onClick={() => navigate(`/workflows/start?type=${encodeURIComponent(row.workflow_type)}&mode=now`)}
              colorClass="text-text-tertiary hover:text-status-success"
            />
          )}
          {row.tier === 'durable' && (
            <RowAction
              icon={Wrench}
              title="Configure workflow"
              onClick={() => navigate(`/workflows/registry/new?workflow_type=${encodeURIComponent(row.workflow_type)}&task_queue=${encodeURIComponent(row.task_queue ?? '')}`)}
              colorClass="text-text-tertiary hover:text-status-info"
            />
          )}
          {row.tier === 'configured' && (
            <RowAction
              icon={ShieldPlus}
              title="Certify workflow"
              onClick={() => navigate(`/workflows/registry/${encodeURIComponent(row.workflow_type)}`)}
              colorClass="text-text-tertiary hover:text-status-success"
            />
          )}
          {row.registered && (
            <RowAction
              icon={ShieldOff}
              title="Remove configuration"
              onClick={() => setConfirmDelete(row.workflow_type)}
              colorClass="text-text-tertiary hover:text-status-warning"
            />
          )}
        </RowActionGroup>
      ),
      className: 'w-16 text-right',
    },
  ];

  const handleDelete = () => {
    if (!confirmDelete) return;
    deleteConfig.mutate(confirmDelete, {
      onSuccess: () => setConfirmDelete(null),
    });
  };

  const handleRowClick = (row: DiscoveredWorkflow) => {
    if (row.registered) {
      navigate(`/workflows/registry/${encodeURIComponent(row.workflow_type)}`);
    } else {
      navigate(`/workflows/registry/new?workflow_type=${encodeURIComponent(row.workflow_type)}&task_queue=${encodeURIComponent(row.task_queue ?? '')}`);
    }
  };

  return (
    <div>
      <PageHeader
        title="Workflow Registry"
        docsHash="#docs:dashboard.md:workflow-registry"
        actions={
          <button
            onClick={() => navigate('/workflows/registry/new')}
            className="btn-primary text-xs"
          >
            Register Workflow
          </button>
        }
      />

      <FilterBar>
        <input
          type="text"
          placeholder="Search workflow type..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="input text-[11px] py-1 px-2 w-56"
        />
        <FilterSelect
          label="Queue"
          value={filters.queue}
          onChange={(v) => setFilter('queue', v)}
          options={queues.map((q) => ({ value: q, label: q }))}
        />
        <FilterSelect
          label="Tier"
          value={filters.tier}
          onChange={(v) => setFilter('tier', v)}
          options={[
            { value: 'certified', label: 'Certified' },
            { value: 'configured', label: 'Configured' },
            { value: 'durable', label: 'Durable' },
          ]}
        />
        <FilterSelect
          label="Role"
          value={filters.role}
          onChange={(v) => setFilter('role', v)}
          options={roles.map((r) => ({ value: r, label: r }))}
        />
      </FilterBar>

      <DataTable
        columns={columns}
        data={workflows}
        keyFn={(row) => row.workflow_type}
        onRowClick={handleRowClick}
        isLoading={isLoading}
        emptyMessage="No workflows found"
      />

      {/* Delete confirmation modal */}
      <ConfirmDeleteModal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title="De-certify Workflow"
        description={<>Remove certification from <span className="font-mono font-medium text-text-primary">{confirmDelete}</span>? This removes interceptor guarantees, escalation chains, and invocation role constraints. The workflow will continue running as a standard durable workflow.</>}
        isPending={deleteConfig.isPending}
        error={deleteConfig.error as Error | null}
      />
    </div>
  );
}
