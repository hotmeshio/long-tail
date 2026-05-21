import { useNavigate } from 'react-router-dom';
import { Radio } from 'lucide-react';
import { useTopics, type TopicCatalogEntry } from '../../api/topics';
import { useFilterParams } from '../../hooks/useFilterParams';
import { DataTable, type Column } from '../../components/common/data/DataTable';
import { StickyPagination } from '../../components/common/data/StickyPagination';
import { FilterBar, FilterSelect } from '../../components/common/data/FilterBar';
import { PageHeader } from '../../components/common/layout/PageHeader';
import { ListToolbar } from '../../components/common/data/ListToolbar';
import { DateValue } from '../../components/common/display/DateValue';

const CATEGORY_COLORS: Record<string, string> = {
  task:       'bg-blue-400/15 text-blue-400',
  workflow:   'bg-accent/15 text-accent',
  escalation: 'bg-amber-400/15 text-amber-400',
  activity:   'bg-cyan-400/15 text-cyan-400',
  knowledge:  'bg-violet-400/15 text-violet-400',
  agent:      'bg-emerald-400/15 text-emerald-400',
  app:        'bg-rose-400/15 text-rose-400',
  milestone:  'bg-violet-400/15 text-violet-400',
};

const CATEGORY_OPTIONS = [
  { value: 'task', label: 'Task' },
  { value: 'workflow', label: 'Workflow' },
  { value: 'escalation', label: 'Escalation' },
  { value: 'activity', label: 'Activity' },
  { value: 'knowledge', label: 'Knowledge' },
  { value: 'agent', label: 'Agent' },
  { value: 'app', label: 'App' },
  { value: 'milestone', label: 'Milestone' },
];

function CategoryPill({ category }: { category: string }) {
  const cls = CATEGORY_COLORS[category] ?? 'bg-zinc-400/15 text-zinc-400';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${cls}`}>
      {category}
    </span>
  );
}

const columns: Column<TopicCatalogEntry>[] = [
  {
    key: 'topic',
    label: 'Topic',
    render: (row) => (
      <div className="flex items-center gap-2 min-w-0">
        <Radio className="w-3 h-3 shrink-0 text-text-quaternary" strokeWidth={1.5} />
        <span className="text-xs font-mono text-text-primary truncate">{row.topic}</span>
      </div>
    ),
  },
  {
    key: 'category',
    label: 'Category',
    render: (row) => <CategoryPill category={row.category} />,
    className: 'w-28',
  },
  {
    key: 'description',
    label: 'Description',
    render: (row) => row.description
      ? <span className="text-[11px] text-text-secondary truncate block max-w-xs">{row.description}</span>
      : <span className="text-text-quaternary">—</span>,
  },
  {
    key: 'source',
    label: 'Source',
    render: (row) => (
      <span className="text-[10px] font-mono text-text-tertiary">{row.source}</span>
    ),
    className: 'w-24',
  },
  {
    key: 'subscriber_count',
    label: 'Subscribers',
    render: (row) => {
      const count = row.subscriber_count ?? 0;
      if (!count) return <span className="text-text-quaternary">—</span>;
      return (
        <span className="inline-flex items-center justify-center min-w-[20px] px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-accent/15 text-accent">
          {count}
        </span>
      );
    },
    className: 'w-24 text-center',
  },
  {
    key: 'last_seen_at',
    label: 'Last Seen',
    render: (row) => row.last_seen_at
      ? <span className="whitespace-nowrap"><DateValue date={row.last_seen_at} /></span>
      : <span className="text-text-quaternary">—</span>,
    className: 'w-28',
  },
];

export function TopicsPage() {
  const navigate = useNavigate();

  const { filters, setFilter, pagination } = useFilterParams({
    filters: { category: '' },
  });

  const { data, isLoading, refetch, isFetching } = useTopics({
    category: filters.category || undefined,
    limit: pagination.pageSize,
    offset: pagination.offset,
  });

  const total = data?.total ?? 0;

  return (
    <div>
      <PageHeader title="Topic Catalog" docsHash="#docs:topics.md" />

      <FilterBar actions={
        <ListToolbar
          onRefresh={() => refetch()}
          isFetching={isFetching}
          apiPath={`/topics?limit=${pagination.pageSize}&offset=${pagination.offset}${filters.category ? `&category=${filters.category}` : ''}`}
        />
      }>
        <FilterSelect
          label="Category"
          value={filters.category}
          onChange={(v) => setFilter('category', v)}
          options={CATEGORY_OPTIONS}
        />
      </FilterBar>

      <DataTable
        columns={columns}
        data={data?.topics ?? []}
        keyFn={(row) => row.topic}
        onRowClick={(row) => navigate(`/topics/${encodeURIComponent(row.topic)}`)}
        isLoading={isLoading}
        emptyMessage="No topics registered yet"
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
