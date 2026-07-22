import { useState, useMemo, useEffect } from 'react';
import { X, MessageSquare } from 'lucide-react';
import { SlidePanel, SlidePanelViews } from '../../../components/common/layout/SlidePanel';
import { useStreamMessages, type StreamMessage } from '../../../api/stream-messages';
import { useFilterParams } from '../../../hooks/useFilterParams';
import { useNamespace } from '../../../hooks/useNamespace';
import { buildApiPath } from '../../../lib/api-path';
import { DataTable, type Column } from '../../../components/common/data/DataTable';
import { StickyPagination } from '../../../components/common/data/StickyPagination';
import { FilterBar, FilterSelect, FilterInput } from '../../../components/common/data/FilterBar';
import { DateValue } from '../../../components/common/display/DateValue';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { ListToolbar } from '../../../components/common/data/ListToolbar';
import { StreamMessageDetail } from './StreamMessageDetail';
import { STATUS_DOT, STATUS_LABEL, STATUS_OPTIONS, SOURCE_OPTIONS, SOURCE_BADGE } from './constants';

function truncateMiddle(str: string, max: number): string {
  if (str.length <= max) return str;
  const half = Math.floor((max - 1) / 2);
  return `${str.slice(0, half)}…${str.slice(-half)}`;
}

export function StreamMessagesPage() {
  const { namespace, available } = useNamespace('namespace');

  const { filters, setFilter, pagination, sort, setSort } = useFilterParams({
    filters: { namespace: '', source: 'worker', status: '', stream_name: '', msg_type: '', topic: '', workflow_name: '', jid: '', aid: '' },
  });

  const [selected, setSelected] = useState<StreamMessage | null>(null);

  const namespaceOptions = useMemo(
    () => available.map((id) => ({ value: id, label: id })),
    [available],
  );

  const { data, isLoading, refetch, isFetching } = useStreamMessages({
    namespace: filters.namespace || namespace,
    source: (filters.source as 'engine' | 'worker') || 'worker',
    limit: pagination.pageSize,
    offset: pagination.offset,
    sort_by: sort.sort_by || 'created_at',
    order: sort.order || 'desc',
    status: (filters.status as any) || undefined,
    stream_name: filters.stream_name || undefined,
    msg_type: filters.msg_type || undefined,
    topic: filters.topic || undefined,
    workflow_name: filters.workflow_name || undefined,
    jid: filters.jid || undefined,
    aid: filters.aid || undefined,
  });

  const messages = data?.messages ?? [];
  const total = data?.total ?? 0;

  const activeMessage = useMemo(() => {
    if (!selected) return null;
    return messages.find((m) => m.id === selected.id && m.source === selected.source) ?? selected;
  }, [messages, selected]);

  const panelOpen = !!activeMessage;

  // Hold the last message through the panel's closing animation so the detail
  // content stays rendered while the panel slides shut.
  const [lastMessage, setLastMessage] = useState<StreamMessage | null>(null);
  useEffect(() => {
    if (activeMessage) setLastMessage(activeMessage);
  }, [activeMessage]);
  const displayMessage = activeMessage ?? lastMessage;

  // Status and type live as the dot and the detail panel — the row itself
  // stays one flexible stream column plus fixed narrow facts, so the table
  // shrinks with the container (same shape as the executions list).
  const columns: Column<StreamMessage>[] = [
    {
      key: 'stream_name',
      label: 'Stream',
      sortable: true,
      render: (row) => (
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`w-1.5 h-1.5 shrink-0 rounded-full dot-ring ${STATUS_DOT[row.status]}`}
            title={STATUS_LABEL[row.status]}
          />
          <span className="font-mono text-xs text-text-secondary truncate" title={row.stream_name}>
            {row.stream_name}
          </span>
        </div>
      ),
    },
    {
      key: 'source',
      label: 'Source',
      render: (row) => <span className={SOURCE_BADGE}>{row.source}</span>,
      className: 'w-24',
    },
    {
      key: 'created_at',
      label: 'Created',
      sortable: true,
      render: (row) => <DateValue date={row.created_at} format="relative" className="text-xs text-text-secondary whitespace-nowrap" />,
      className: 'w-32',
    },
    {
      key: 'reserved_at',
      label: 'Reserved',
      render: (row) => row.reserved_at
        ? <DateValue date={row.reserved_at} format="relative" className="text-xs text-text-secondary whitespace-nowrap" />
        : <span className="text-xs text-text-tertiary">—</span>,
      className: 'w-32',
    },
    {
      key: 'expired_at',
      label: 'Processed',
      render: (row) => row.expired_at
        ? <DateValue date={row.expired_at} format="relative" className="text-xs text-text-secondary whitespace-nowrap" />
        : <span className="text-xs text-text-tertiary">—</span>,
      className: 'w-32',
    },
    {
      key: 'priority',
      label: 'Pri',
      sortable: true,
      render: (row) => <span className="text-xs text-text-secondary">{row.priority}</span>,
      className: 'w-14 text-right',
    },
    {
      key: 'retry_attempt',
      label: 'Retries',
      render: (row) => (
        <span className="text-xs text-text-secondary whitespace-nowrap">
          {row.retry_attempt}/{row.max_retry_attempts}
        </span>
      ),
      className: 'w-20',
    },
  ];

  return (
    // Master-list flow beside a full-height panel: the left column is a plain
    // page-scrolling list (FilterBar and table headers stick against the main
    // scroll, exactly like the executions list). The panel column spans the
    // page height; its sticky viewport stays pinned with its own scroll.
    // Negative margins let the panel span the full middle row; the left
    // column re-adds those gutters for its own content.
    <div className="flex items-stretch min-w-0 -mt-10 -mr-10 -mb-16">
      <div className="flex-1 min-w-0 pt-10 pr-10">
        <PageHeader title="Messages" docsHash="#docs:dashboard.md:messages" />

        <FilterBar actions={
        <ListToolbar
          onRefresh={() => refetch()}
          isFetching={isFetching}
          apiPath={buildApiPath('/controlplane/stream-messages', {
            namespace: filters.namespace || namespace,
            source: filters.source || 'worker',
            limit: pagination.pageSize,
            offset: pagination.offset,
            sort_by: sort.sort_by || 'created_at',
            order: sort.order || 'desc',
            status: filters.status || undefined,
            stream_name: filters.stream_name || undefined,
            msg_type: filters.msg_type || undefined,
            topic: filters.topic || undefined,
            workflow_name: filters.workflow_name || undefined,
            jid: filters.jid || undefined,
            aid: filters.aid || undefined,
          })}
        />
      }>
        <FilterSelect
          label="Namespace"
          value={filters.namespace}
          onChange={(v) => setFilter('namespace', v)}
          options={namespaceOptions}
          required
        />
        <FilterSelect
          label="Source"
          value={filters.source}
          onChange={(v) => setFilter('source', v)}
          options={SOURCE_OPTIONS}
          required
        />
        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(v) => setFilter('status', v)}
          options={STATUS_OPTIONS}
        />
        <FilterInput
          label="Stream"
          value={filters.stream_name}
          onChange={(v) => setFilter('stream_name', v)}
          placeholder="Filter by stream name…"
        />
        <FilterInput
          label="Job ID"
          value={filters.jid}
          onChange={(v) => setFilter('jid', v)}
          placeholder="Filter by jid…"
        />
        {/* Active dimension filter pills — inline in the sticky bar */}
        {[
          { key: 'topic', label: 'Topic', value: filters.topic },
          { key: 'workflow_name', label: 'Workflow', value: filters.workflow_name },
          { key: 'aid', label: 'Activity', value: filters.aid },
          { key: 'msg_type', label: 'Type', value: filters.msg_type },
        ].filter((f) => f.value).map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key as any, '')}
            className="inline-flex items-center gap-1 px-2 py-0.5 text-2xs font-mono rounded-full bg-accent/15 text-accent hover:bg-accent/25 transition-colors"
            title={`Clear ${f.label} filter: ${f.value}`}
          >
            {f.label}: {truncateMiddle(f.value, 12)}
            <X className="w-2.5 h-2.5" />
          </button>
        ))}
      </FilterBar>

        <DataTable
          columns={columns}
          data={messages}
          keyFn={(row) => `${row.source}:${row.id}`}
          isLoading={isLoading}
          emptyMessage="No stream messages found"
          onRowClick={(row) => setSelected(row)}
          activeRowKey={activeMessage ? `${activeMessage.source}:${activeMessage.id}` : null}
          sort={sort}
          onSort={setSort}
          layout="fixed"
        />

        {/* Direct child of the tall column so sticky works; its -mx-10 fills
            the column's pr-10, ending flush at the panel's edge. */}
        <StickyPagination
          page={pagination.page}
          totalPages={pagination.totalPages(total)}
          onPageChange={pagination.setPage}
          total={total}
          pageSize={pagination.pageSize}
          onPageSizeChange={pagination.setPageSize}
        />
      </div>

      {/* Detail panel — spans the page height; the sticky viewport keeps the
          chrome pinned to the visible area with its own scroll. */}
      <SlidePanel open={panelOpen} width={416} className="self-stretch">
        <div className="h-full pl-4">
          <SlidePanelViews
            views={[{
              id: 'detail',
              icon: MessageSquare,
              label: 'Message Detail',
              content: displayMessage ? (
                <StreamMessageDetail
                  message={displayMessage}
                  filters={{
                    onFilterStatus: (v) => setFilter('status', v),
                    onFilterStreamName: (v) => setFilter('stream_name', v),
                    onFilterMsgType: (v) => setFilter('msg_type', v),
                    onFilterTopic: (v) => setFilter('topic', v),
                    onFilterWorkflow: (v) => setFilter('workflow_name', v),
                    onFilterJid: (v) => setFilter('jid', v),
                    onFilterAid: (v) => setFilter('aid', v),
                  }}
                />
              ) : null,
            }]}
            activeId="detail"
            onViewChange={() => {}}
            onClose={() => setSelected(null)}
            stickyClassName="sticky top-0 z-10 h-[calc(100vh-5.25rem)] pt-9"
          />
        </div>
      </SlidePanel>
    </div>
  );
}
