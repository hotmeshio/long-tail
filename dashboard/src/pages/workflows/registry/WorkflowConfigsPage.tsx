import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useDiscoveredWorkflows,
  useDeleteWorkflowConfig,
} from '../../../api/workflows';
import { Trash2, Play, Plus } from 'lucide-react';
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
    if (filters.tier === 'registered') result = result.filter((w) => w.registered);
    if (filters.tier === 'unregistered') result = result.filter((w) => !w.registered);
    if (filters.tier === 'durable') result = result.filter((w) => !w.registered);
    if (filters.tier === 'unbreakable') result = result.filter((w) => w.registered);
    return result;
  }, [allWorkflows, filters]);

  const columns: Column<DiscoveredWorkflow>[] = [
    {
      key: 'workflow_type',
      label: 'Workflow',
      render: (row) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <WorkflowPill type={row.workflow_type} />
            {row.invocable && (
              <Play className="w-3 h-3 shrink-0 text-accent/60" strokeWidth={2} aria-label="Invocable" />
            )}
          </div>
          {row.description && (
            <p className="text-[10px] text-text-tertiary mt-0.5 truncate">{row.description}</p>
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
      key: 'registered',
      label: 'Tier',
      render: (row) => row.registered
        ? <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-accent/10 text-accent">Registered</span>
        : <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-sunken text-text-tertiary">Durable</span>,
      className: 'whitespace-nowrap',
    },
    {
      key: 'roles',
      label: 'Roles',
      render: (row) => row.registered ? (
        <div className="flex gap-1 flex-wrap">
          {(row.roles ?? []).map((r) => (
            <RolePill key={r} role={r} />
          ))}
          {(!row.roles || row.roles.length === 0) && <span className="text-xs text-text-tertiary">—</span>}
        </div>
      ) : (
        <span className="text-xs text-text-tertiary">—</span>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (row) => (
        <RowActionGroup>
          {row.registered ? (
            <RowAction
              icon={Trash2}
              title="Delete config"
              onClick={() => setConfirmDelete(row.workflow_type)}
              colorClass="text-text-tertiary hover:text-status-error"
            />
          ) : (
            <RowAction
              icon={Plus}
              title="Register workflow"
              onClick={() => navigate(`/workflows/registry/new?workflow_type=${encodeURIComponent(row.workflow_type)}&task_queue=${encodeURIComponent(row.task_queue ?? '')}`)}
              colorClass="text-text-tertiary hover:text-accent"
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
        title="Worker Registry"
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
            { value: 'registered', label: 'Registered' },
            { value: 'unregistered', label: 'Unregistered' },
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
        title="Delete Workflow Config"
        description={<>Delete <span className="font-mono font-medium text-text-primary">{confirmDelete}</span>? This will cascade-delete associated roles and invocation roles.</>}
        isPending={deleteConfig.isPending}
        error={deleteConfig.error as Error | null}
      />
    </div>
  );
}
