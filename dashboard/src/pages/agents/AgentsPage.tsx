import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAgents, type Agent } from '../../api/agents';
import { useSettings } from '../../api/settings';
import { useAgentEvents } from '../../hooks/useEventHooks';
import { useFilterParams } from '../../hooks/useFilterParams';
import { DataTable, type Column } from '../../components/common/data/DataTable';
import { StickyPagination } from '../../components/common/data/StickyPagination';
import { FilterBar, FilterSelect } from '../../components/common/data/FilterBar';
import { PageHeader } from '../../components/common/layout/PageHeader';
import { ListToolbar } from '../../components/common/data/ListToolbar';
import { DateValue } from '../../components/common/display/DateValue';

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'paused', label: 'Paused' },
  { value: 'error', label: 'Error' },
];

const columns: Column<Agent>[] = [
  {
    key: 'name',
    label: 'Agent',
    render: (row) => (
      <div className="flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${row.status === 'active' ? 'bg-emerald-400' : row.status === 'paused' ? 'bg-amber-400' : row.status === 'error' ? 'bg-red-400' : 'bg-zinc-500'}`} />
        <div className="min-w-0">
          <span className="text-xs font-medium text-text-primary block">{row.id}</span>
          {row.description && <p className="text-[10px] text-text-tertiary truncate">{row.description}</p>}
        </div>
      </div>
    ),
  },
  {
    key: 'knowledge_domain',
    label: 'Knowledge',
    render: (row) => row.knowledge_domain
      ? <span className="text-[10px] font-mono text-text-secondary whitespace-nowrap">{row.knowledge_domain}</span>
      : <span className="text-text-quaternary">—</span>,
    className: 'w-28',
  },
  {
    key: 'schedules',
    label: 'Schedules',
    render: (row) => {
      const scheds = (row.behaviors as any)?.schedules as any[] | undefined;
      const crons = scheds?.length ? scheds.map((s: any) => s.cron) : row.behaviors?.cron ? [row.behaviors.cron] : [];
      if (!crons.length) return <span className="text-text-quaternary">—</span>;
      return <span className="text-[10px] font-mono text-text-secondary whitespace-nowrap">{crons[0]}{crons.length > 1 ? ` +${crons.length - 1}` : ''}</span>;
    },
    className: 'w-28',
  },
  {
    key: 'subscriptions',
    label: 'Subscriptions',
    render: (row) => {
      const count = row.subscription_count ?? 0;
      const topics = row.sub_topics ?? [];
      if (!count) return <span className="text-text-quaternary">—</span>;
      const first = topics[0]?.replace(/^lt\.events\./, '') ?? '';
      return <span className="text-[10px] font-mono text-text-secondary whitespace-nowrap">{first}{count > 1 ? ` +${count - 1}` : ''}</span>;
    },
    className: 'w-36',
  },
  {
    key: 'last_run_at',
    label: 'Last Run',
    render: (row) => row.last_run_at
      ? <span className="whitespace-nowrap"><DateValue date={row.last_run_at} /></span>
      : <span className="text-text-quaternary">—</span>,
    className: 'w-32',
  },
];

export function AgentsPage() {
  const navigate = useNavigate();
  const { data: settings } = useSettings();
  const aiEnabled = !!settings?.ai?.enabled;
  const label = aiEnabled ? 'Agent' : 'Automation';
  const labelPlural = aiEnabled ? 'Agents' : 'Automations';
  useAgentEvents();

  const { filters, setFilter, pagination } = useFilterParams({
    filters: { status: '' },
  });

  const { data, isLoading, refetch, isFetching } = useAgents({
    status: filters.status || undefined,
    limit: pagination.pageSize,
    offset: pagination.offset,
  });

  const total = data?.total ?? 0;

  return (
    <div>
      <PageHeader
        title={labelPlural}
        docsHash="#docs:agents.md"
        actions={
          <button
            onClick={() => navigate('/agents/new')}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-md bg-accent text-text-inverse hover:bg-accent-hover transition-colors"
          >
            <Plus className="w-4 h-4" /> Create {label}
          </button>
        }
      />

      <FilterBar actions={
        <ListToolbar
          onRefresh={() => refetch()}
          isFetching={isFetching}
          apiPath={`/agents?limit=${pagination.pageSize}&offset=${pagination.offset}${filters.status ? `&status=${filters.status}` : ''}`}
        />
      }>
        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(v) => setFilter('status', v)}
          options={STATUS_OPTIONS}
        />
      </FilterBar>

      <DataTable
        columns={columns}
        data={data?.agents ?? []}
        keyFn={(row) => row.id}
        onRowClick={(row) => navigate(`/agents/${row.id}`)}
        isLoading={isLoading}
        emptyMessage={`No ${labelPlural.toLowerCase()} found`}
      />

      <StickyPagination
        page={pagination.page}
        totalPages={pagination.totalPages(total)}
        onPageChange={pagination.setPage}
        total={total}
        pageSize={pagination.pageSize}
        onPageSizeChange={pagination.setPageSize}
      />
    </div>
  );
}
