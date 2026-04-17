import { useNavigate } from 'react-router-dom';
import { MessageSquare, Lightbulb, Layers, Circle } from 'lucide-react';

import { PageHeader } from '../../components/common/layout/PageHeader';
import { DataTable, type Column } from '../../components/common/data/DataTable';
import { FilterBar, FilterSelect } from '../../components/common/data/FilterBar';
import { StickyPagination } from '../../components/common/data/StickyPagination';
import { TimestampCell } from '../../components/common/display/TimestampCell';
import { ElapsedCell } from '../../components/common/display/ElapsedCell';
import { WorkflowPill } from '../../components/common/display/WorkflowPill';
import { EmptyState } from '../../components/common/display/EmptyState';
import { useFilterParams } from '../../hooks/useFilterParams';
import { useWorkflowListEvents } from '../../hooks/useNatsEvents';
import { useMcpQueryJobs } from '../../api/mcp-query';
import type { LTJob } from '../../api/types';

function mapStatus(job: LTJob): string {
  if (job.status === 'completed') return 'completed';
  if (Number(job.status) === 0) return 'completed';
  if (job.is_live) return 'in_progress';
  return 'failed';
}

function buildColumns(navigate: ReturnType<typeof useNavigate>): Column<LTJob>[] {
  return [
    {
      key: 'entity',
      label: 'Workflow Type',
      className: 'whitespace-nowrap',
      render: (row) => {
        const s = mapStatus(row);
        const dotColor = s === 'completed' ? 'fill-status-success text-status-success'
          : s === 'in_progress' ? 'fill-status-active text-status-active animate-pulse'
          : 'fill-status-error text-status-error';
        return (
          <span className="inline-flex items-center gap-2">
            <Circle className={`w-2.5 h-2.5 shrink-0 ${dotColor}`} />
            <WorkflowPill type={(row as any).entity || 'unknown'} />
          </span>
        );
      },
    },
    {
      key: 'workflow_id',
      label: 'Workflow ID',
      render: (row) => (
        <span className="text-xs font-mono text-text-primary truncate block">
          {row.workflow_id}
        </span>
      ),
    },
    {
      key: 'created_at',
      label: 'Created',
      className: 'w-36',
      sortable: true,
      render: (row) => <TimestampCell date={row.created_at} />,
    },
    {
      key: 'duration',
      label: 'Duration',
      render: (row) => (
        <ElapsedCell
          startDate={row.created_at}
          endDate={mapStatus(row) === 'in_progress' ? null : row.updated_at}
          isLive={mapStatus(row) === 'in_progress'}
        />
      ),
    },
    {
      key: 'actions',
      label: '',
      className: 'w-28',
      render: (row) => {
        const s = mapStatus(row);
        const isComplete = s === 'completed';
        return (
          <span className="opacity-0 group-hover/row:opacity-100 transition-opacity flex items-center gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); navigate(`/mcp/queries/${row.workflow_id}?step=1`); }}
              className="text-text-tertiary hover:text-accent transition-colors"
              title="Describe"
            >
              <MessageSquare className="w-3.5 h-3.5" strokeWidth={1.5} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); navigate(`/mcp/queries/${row.workflow_id}?step=2`); }}
              className="text-text-tertiary hover:text-status-warning transition-colors"
              title="Discover"
            >
              <Lightbulb className="w-3.5 h-3.5" strokeWidth={1.5} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); navigate(`/mcp/queries/${row.workflow_id}?step=3`); }}
              className={`transition-colors ${isComplete ? 'text-text-tertiary hover:text-status-success' : 'text-text-tertiary/30 cursor-not-allowed'}`}
              title={isComplete ? 'Compile' : 'Complete discovery first'}
              disabled={!isComplete}
            >
              <Layers className="w-3.5 h-3.5" strokeWidth={1.5} />
            </button>
          </span>
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

  const { data, isLoading } = useMcpQueryJobs({
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
          <button
            onClick={() => navigate('/mcp/queries/new')}
            className="btn-primary text-xs"
          >
            Design Pipeline
          </button>
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
