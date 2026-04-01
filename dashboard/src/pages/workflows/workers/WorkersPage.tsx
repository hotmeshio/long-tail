import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Eye } from 'lucide-react';
import { useActiveWorkers } from '../../../api/workflows';
import { DataTable, type Column } from '../../../components/common/data/DataTable';
import { FilterBar, FilterSelect } from '../../../components/common/data/FilterBar';
import { RowAction, RowActionGroup } from '../../../components/common/layout/RowActions';
import { useFilterParams } from '../../../hooks/useFilterParams';
import type { ActiveWorker } from '../../../api/types';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { TaskQueuePill } from '../../../components/common/display/TaskQueuePill';
import { WorkflowPill } from '../../../components/common/display/WorkflowPill';

// ── Page ──────────────────────────────────────────────────────────────────────

export function WorkersPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useActiveWorkers();
  const { filters, setFilter } = useFilterParams({
    filters: { search: '', queue: '' },
  });

  const [searchInput, setSearchInput] = useState(filters.search);

  useEffect(() => {
    if (searchInput === filters.search) return;
    const timer = setTimeout(() => setFilter('search', searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput, setFilter, filters.search]);

  const allWorkers = data ?? [];

  const queues = useMemo(
    () => [...new Set(allWorkers.map((w) => w.task_queue).filter(Boolean))].sort(),
    [allWorkers],
  );

  const workers = useMemo(() => {
    let result = allWorkers;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter((w) => w.name.toLowerCase().includes(q));
    }
    if (filters.queue) result = result.filter((w) => w.task_queue === filters.queue);
    return result;
  }, [allWorkers, filters]);

  const columns: Column<ActiveWorker>[] = [
    {
      key: 'name',
      label: 'Workflow',
      render: (row) => <WorkflowPill type={row.name} />,
    },
    {
      key: 'task_queue',
      label: 'Queue',
      render: (row) => <TaskQueuePill queue={row.task_queue} />,
      className: 'whitespace-nowrap',
    },
    {
      key: 'registered',
      label: 'Status',
      render: (row) => row.registered
        ? <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-accent/10 text-accent">Registered</span>
        : <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-sunken text-text-tertiary">Unregistered</span>,
      className: 'whitespace-nowrap',
    },
    {
      key: 'actions',
      label: '',
      render: (row) => (
        <RowActionGroup>
          {row.registered ? (
            <RowAction
              icon={Eye}
              title="View config"
              onClick={() => navigate(`/workflows/registry/${encodeURIComponent(row.name)}`)}
            />
          ) : (
            <RowAction
              icon={Plus}
              title="Register workflow"
              onClick={() => navigate(`/workflows/registry/new?workflow_type=${encodeURIComponent(row.name)}&task_queue=${encodeURIComponent(row.task_queue)}`)}
            />
          )}
        </RowActionGroup>
      ),
      className: 'w-16 text-right',
    },
  ];

  const handleRowClick = (row: ActiveWorker) => {
    if (row.registered) {
      navigate(`/workflows/registry/${encodeURIComponent(row.name)}`);
    } else {
      navigate(`/workflows/registry/new?workflow_type=${encodeURIComponent(row.name)}&task_queue=${encodeURIComponent(row.task_queue)}`);
    }
  };

  return (
    <div>
      <PageHeader title="All Workers" />

      <FilterBar>
        <input
          type="text"
          placeholder="Search workers..."
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
      </FilterBar>

      <DataTable
        columns={columns}
        data={workers}
        keyFn={(row) => row.name}
        onRowClick={handleRowClick}
        isLoading={isLoading}
        emptyMessage="No active workers"
      />
    </div>
  );
}
