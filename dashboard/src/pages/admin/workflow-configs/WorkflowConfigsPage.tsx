import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useWorkflowConfigs,
  useDeleteWorkflowConfig,
} from '../../../api/workflows';
import { Trash2 } from 'lucide-react';
import { DataTable, type Column } from '../../../components/common/DataTable';
import { ConfirmDeleteModal } from '../../../components/common/ConfirmDeleteModal';
import { FilterBar, FilterSelect } from '../../../components/common/FilterBar';
import { RowAction, RowActionGroup } from '../../../components/common/RowActions';
import { useFilterParams } from '../../../hooks/useFilterParams';
import type { LTWorkflowConfig } from '../../../api/types';
import { PageHeader } from '../../../components/common/PageHeader';

// ── Helpers ───────────────────────────────────────────────────────────────────

function matchesSearch(config: LTWorkflowConfig, search: string): boolean {
  const q = search.toLowerCase();
  return (
    config.workflow_type.toLowerCase().includes(q) ||
    (config.description ?? '').toLowerCase().includes(q)
  );
}

function matchesKind(config: LTWorkflowConfig, kind: string): boolean {
  if (!kind) return true;
  if (kind === 'lt') return config.is_lt && !config.is_container;
  if (kind === 'container') return config.is_container;
  if (kind === 'invocable') return config.invocable;
  if (kind === 'cron') return !!config.cron_schedule;
  return true;
}

const KIND_OPTIONS = [
  { value: 'lt', label: 'Leaf (LT)' },
  { value: 'container', label: 'Container' },
  { value: 'invocable', label: 'Invocable' },
  { value: 'cron', label: 'Cron' },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export function WorkflowConfigsPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useWorkflowConfigs();
  const deleteConfig = useDeleteWorkflowConfig();
  const { filters, setFilter } = useFilterParams({
    filters: { search: '', queue: '', kind: '', role: '' },
  });

  const [searchInput, setSearchInput] = useState(filters.search);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Debounce search input
  useEffect(() => {
    if (searchInput === filters.search) return;
    const timer = setTimeout(() => setFilter('search', searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput, setFilter, filters.search]);

  const allConfigs = data ?? [];

  // Derive facet options from data
  const queues = useMemo(
    () => [...new Set(allConfigs.map((c) => c.task_queue))].sort(),
    [allConfigs],
  );
  const roles = useMemo(
    () => [...new Set(allConfigs.flatMap((c) => c.roles ?? []))].sort(),
    [allConfigs],
  );

  // Apply client-side filters
  const configs = useMemo(() => {
    let result = allConfigs;
    if (filters.search) result = result.filter((c) => matchesSearch(c, filters.search));
    if (filters.queue) result = result.filter((c) => c.task_queue === filters.queue);
    if (filters.kind) result = result.filter((c) => matchesKind(c, filters.kind));
    if (filters.role) result = result.filter((c) => (c.roles ?? []).includes(filters.role));
    return result;
  }, [allConfigs, filters]);

  const columns: Column<LTWorkflowConfig>[] = [
    {
      key: 'workflow_type',
      label: 'Workflow Type',
      render: (row) => (
        <div>
          <span className="font-mono text-xs">{row.workflow_type}</span>
          {row.description && (
            <p className="text-[10px] text-text-tertiary mt-0.5">{row.description}</p>
          )}
        </div>
      ),
    },
    {
      key: 'task_queue',
      label: 'Task Queue',
      render: (row) => <span className="font-mono text-xs text-text-secondary">{row.task_queue}</span>,
    },
    {
      key: 'is_lt',
      label: 'LT',
      render: (row) => (
        <span className={`text-xs ${row.is_lt ? 'text-text-primary' : 'text-text-tertiary'}`}>
          {row.is_lt ? 'Yes' : 'No'}
        </span>
      ),
      className: 'w-16',
    },
    {
      key: 'is_container',
      label: 'Container',
      render: (row) => (
        <span className={`text-xs ${row.is_container ? 'text-text-primary' : 'text-text-tertiary'}`}>
          {row.is_container ? 'Yes' : 'No'}
        </span>
      ),
      className: 'w-24',
    },
    {
      key: 'invocable',
      label: 'Invocable',
      render: (row) => (
        <span className={`text-xs ${row.invocable ? 'text-text-primary' : 'text-text-tertiary'}`}>
          {row.invocable ? 'Yes' : 'No'}
        </span>
      ),
      className: 'w-24',
    },
    {
      key: 'schemas',
      label: 'Schemas',
      render: (row) => (
        <div className="flex gap-1 flex-wrap">
          {row.envelope_schema && (
            <span className="px-1.5 py-0.5 text-[10px] bg-accent/10 text-accent rounded">env</span>
          )}
          {row.resolver_schema && (
            <span className="px-1.5 py-0.5 text-[10px] bg-accent/10 text-accent rounded">res</span>
          )}
          {row.cron_schedule && (
            <span className="px-1.5 py-0.5 text-[10px] bg-status-warning/10 text-status-warning rounded font-mono">{row.cron_schedule}</span>
          )}
        </div>
      ),
      className: 'w-32',
    },
    {
      key: 'default_role',
      label: 'Default Role',
      render: (row) => <span className="text-xs text-text-secondary">{row.default_role}</span>,
    },
    {
      key: 'roles',
      label: 'Roles',
      render: (row) => (
        <div className="flex gap-1 flex-wrap">
          {(row.roles ?? []).map((r) => (
            <span key={r} className="px-2 py-0.5 text-[10px] bg-surface-sunken rounded-full text-text-secondary">
              {r}
            </span>
          ))}
        </div>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (row) => (
        <RowActionGroup>
          <RowAction
            icon={Trash2}
            title="Delete config"
            onClick={() => setConfirmDelete(row.workflow_type)}
            colorClass="text-text-tertiary hover:text-status-error"
          />
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

  return (
    <div>
      <PageHeader
        title="Workflow Configurations"
        actions={
          <button
            onClick={() => navigate('/admin/config/new')}
            className="btn-primary text-xs"
          >
            Add Config
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
          label="Kind"
          value={filters.kind}
          onChange={(v) => setFilter('kind', v)}
          options={KIND_OPTIONS}
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
        data={configs}
        keyFn={(row) => row.workflow_type}
        onRowClick={(row) => navigate(`/admin/config/${encodeURIComponent(row.workflow_type)}`)}
        isLoading={isLoading}
        emptyMessage="No workflow configurations found"
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
