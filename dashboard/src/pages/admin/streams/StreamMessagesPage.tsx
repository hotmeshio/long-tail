import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useStreamMessages, type StreamMessage } from '../../../api/stream-messages';
import { useFilterParams } from '../../../hooks/useFilterParams';
import { useNamespace } from '../../../hooks/useNamespace';
import { buildApiPath } from '../../../lib/api-path';
import { DataTable, type Column } from '../../../components/common/data/DataTable';
import { StickyPagination } from '../../../components/common/data/StickyPagination';
import { FilterBar, FilterSelect, FilterInput } from '../../../components/common/data/FilterBar';
import { TimestampCell } from '../../../components/common/display/TimestampCell';
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

  const columns: Column<StreamMessage>[] = [
    {
      key: 'status',
      label: 'Status',
      render: (row) => (
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full dot-ring shrink-0 ${STATUS_DOT[row.status]}`} />
          <span className="text-xs">{STATUS_LABEL[row.status]}</span>
        </div>
      ),
      className: 'w-28',
    },
    {
      key: 'source',
      label: 'Source',
      render: (row) => <span className={SOURCE_BADGE}>{row.source}</span>,
      className: 'w-20',
    },
    {
      key: 'stream_name',
      label: 'Stream',
      sortable: true,
      render: (row) => (
        <span className="font-mono text-xs text-text-secondary truncate block max-w-[240px]" title={row.stream_name}>
          {row.stream_name}
        </span>
      ),
    },
    {
      key: 'msg_type',
      label: 'Type',
      render: (row) => (
        <span className="text-xs text-text-secondary">{row.msg_type || '—'}</span>
      ),
      className: 'w-24',
    },
    {
      key: 'created_at',
      label: 'Created',
      sortable: true,
      render: (row) => <TimestampCell date={row.created_at} />,
      className: 'w-44',
    },
    {
      key: 'reserved_at',
      label: 'Reserved',
      render: (row) => row.reserved_at ? <TimestampCell date={row.reserved_at} /> : <span className="text-xs text-text-tertiary">—</span>,
      className: 'w-44',
    },
    {
      key: 'expired_at',
      label: 'Processed',
      render: (row) => row.expired_at ? <TimestampCell date={row.expired_at} /> : <span className="text-xs text-text-tertiary">—</span>,
      className: 'w-44',
    },
    {
      key: 'priority',
      label: 'Pri',
      sortable: true,
      render: (row) => <span className="text-xs text-text-secondary">{row.priority}</span>,
      className: 'w-12 text-right',
    },
    {
      key: 'retry_attempt',
      label: 'Retries',
      render: (row) => (
        <span className="text-xs text-text-secondary">
          {row.retry_attempt}/{row.max_retry_attempts}
        </span>
      ),
      className: 'w-16',
    },
  ];

  return (
    <div>
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
            className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono rounded-full bg-accent/15 text-accent hover:bg-accent/25 transition-colors"
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
      />

      <StickyPagination
        page={pagination.page}
        totalPages={pagination.totalPages(total)}
        onPageChange={pagination.setPage}
        total={total}
        pageSize={pagination.pageSize}
        onPageSizeChange={pagination.setPageSize}
      />

      {/* Detail panel — portaled to body so fixed positioning works */}
      {panelOpen && createPortal(
        <div className="fixed right-0 bottom-0 w-[400px] z-40 border-l border-surface-border bg-surface overflow-y-auto shadow-lg" style={{ top: '3.5rem' }}>
          <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 bg-surface border-b border-surface-border/50">
            <span className="text-xs font-medium text-text-primary">Message Detail</span>
            <button
              onClick={() => setSelected(null)}
              className="p-1 rounded hover:bg-surface-hover text-text-tertiary hover:text-text-primary transition-colors"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="px-4 py-4">
            <StreamMessageDetail
              message={activeMessage}
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
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
