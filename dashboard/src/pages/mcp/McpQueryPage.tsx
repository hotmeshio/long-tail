import { useNavigate } from 'react-router-dom';
import { MessageSquare, Lightbulb, Layers } from 'lucide-react';

import { PageHeader } from '../../components/common/layout/PageHeader';
import { DataTable, type Column } from '../../components/common/data/DataTable';
import { FilterBar, FilterSelect } from '../../components/common/data/FilterBar';
import { StickyPagination } from '../../components/common/data/StickyPagination';
import { RefreshButton } from '../../components/common/data/RefreshButton';
import { TimestampCell } from '../../components/common/display/TimestampCell';
import { ElapsedCell } from '../../components/common/display/ElapsedCell';
import { WorkflowPill } from '../../components/common/display/WorkflowPill';
import { EmptyState } from '../../components/common/display/EmptyState';
import { RowActionGroup } from '../../components/common/layout/RowActions';
import { useFilterParams } from '../../hooks/useFilterParams';
import { useWorkflowListEvents } from '../../hooks/useNatsEvents';
import { useMcpQueryJobs } from '../../api/mcp-query';
import type { LTJob } from '../../api/types';

const STATUS_DOT: Record<string, string> = {
  in_progress: 'bg-status-active',
  completed: 'bg-status-success',
  failed: 'bg-status-error',
};

function mapStatus(job: LTJob): string {
  if (job.status === 'completed') return 'completed';
  if (Number(job.status) === 0) return 'completed';
  if (job.is_live) return 'in_progress';
  return 'failed';
}

function buildColumns(navigate: ReturnType<typeof useNavigate>): Column<LTJob>[] {
  return [
    {
      key: 'workflow_id',
      label: 'Workflow ID / Type',
      render: (row) => {
        const s = mapStatus(row);
        const dotClass = STATUS_DOT[s] ?? 'bg-status-pending';
        const pulseClass = s === 'in_progress' ? ' animate-pulse' : '';
        return (
          <div className="flex items-start gap-2 min-w-0">
            <span className={`w-[9px] h-[9px] shrink-0 rounded-full mt-1 ${dotClass}${pulseClass}`} title={s} />
            <div className="min-w-0">
              <span className="font-mono text-xs text-text-primary truncate block">
                {row.workflow_id}
              </span>
              <div className="mt-0.5">
                <WorkflowPill type={row.entity || 'unknown'} />
              </div>
            </div>
          </div>
        );
      },
    },
    {
      key: 'created_at',
      label: 'Created',
      render: (row) => <TimestampCell date={row.created_at} />,
      className: 'w-40',
      sortable: true,
    },
    {
      key: 'updated_at',
      label: 'Updated',
      render: (row) => <TimestampCell date={row.updated_at} />,
      className: 'w-40',
      sortable: true,
    },
    {
      key: 'duration',
      label: 'Duration',
      render: (row) => {
        const s = mapStatus(row);
        return (
          <ElapsedCell
            startDate={row.created_at}
            endDate={s === 'in_progress' ? null : row.updated_at}
            isLive={s === 'in_progress'}
          />
        );
      },
      className: 'w-28',
    },
    {
      key: 'actions',
      label: '',
      className: 'w-28',
      render: (row) => {
        const s = mapStatus(row);
        const isComplete = s === 'completed';
        return (
          <RowActionGroup>
            <button
              onClick={(e) => { e.stopPropagation(); navigate(`/mcp/queries/${row.workflow_id}?step=1`); }}
              className="opacity-0 group-hover/row:opacity-100 text-text-tertiary hover:text-accent transition-all"
              title="Describe"
            >
              <MessageSquare className="w-3.5 h-3.5" strokeWidth={1.5} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); navigate(`/mcp/queries/${row.workflow_id}?step=2`); }}
              className="opacity-0 group-hover/row:opacity-100 text-text-tertiary hover:text-status-warning transition-all"
              title="Discover"
            >
              <Lightbulb className="w-3.5 h-3.5" strokeWidth={1.5} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); navigate(`/mcp/queries/${row.workflow_id}?step=3`); }}
              className={`opacity-0 group-hover/row:opacity-100 transition-all ${isComplete ? 'text-text-tertiary hover:text-status-success' : 'text-text-tertiary/30 cursor-not-allowed'}`}
              title={isComplete ? 'Compile' : 'Complete discovery first'}
              disabled={!isComplete}
            >
              <Layers className="w-3.5 h-3.5" strokeWidth={1.5} />
            </button>
          </RowActionGroup>
        );
      },
    },
  ];
}

export function McpQueryPage() {
  const navigate = useNavigate();
  const columns = buildColumns(navigate);

  const { filters, setFilter, pagination, sort, setSort } = useFilterParams({
    filters: { search: '', status: '', type: '' },
    pageSize: 20,
  });

  const { data, isLoading, refetch } = useMcpQueryJobs({
    limit: pagination.pageSize,
    offset: pagination.offset,
    search: filters.search,
    status: filters.status,
    entity: filters.type || undefined,
  });

  useWorkflowListEvents();

  const jobs = data?.jobs ?? [];
  const total = data?.total ?? 0;

  return (
    <>
      <PageHeader
        title="Pipeline Designer"
        actions={
          <div className="flex items-center gap-3">
            <RefreshButton onClick={() => refetch()} />
            <button
              onClick={() => navigate('/mcp/queries/new')}
              className="btn-primary text-xs"
            >
              Design Pipeline
            </button>
          </div>
        }
      />

      <FilterBar>
          <FilterSelect
            label="Type"
            value={filters.type}
            onChange={(v) => setFilter('type', v)}
            options={[
              { value: 'mcpQuery', label: 'mcpQuery' },
              { value: 'mcpTriage', label: 'mcpTriage' },
            ]}
          />
          <FilterSelect
            label="Status"
            value={filters.status}
            onChange={(v) => setFilter('status', v)}
            options={[
              { value: 'completed', label: 'Completed' },
              { value: 'running', label: 'Running' },
              { value: 'failed', label: 'Failed' },
            ]}
          />
      </FilterBar>

      <DataTable
        columns={columns}
        data={jobs}
        keyFn={(row) => row.workflow_id}
        onRowClick={(row) => navigate(`/mcp/queries/${row.workflow_id}`)}
        isLoading={isLoading}
        emptyMessage=""
        sort={sort}
        onSort={setSort}
      />

      {!isLoading && jobs.length === 0 && (
        <EmptyState title="No pipeline runs yet" description="Click &quot;Design Pipeline&quot; to start" />
      )}

      <StickyPagination
        page={pagination.page}
        pageSize={pagination.pageSize}
        total={total}
        totalPages={pagination.totalPages(total)}
        onPageChange={pagination.setPage}
      />
    </>
  );
}
