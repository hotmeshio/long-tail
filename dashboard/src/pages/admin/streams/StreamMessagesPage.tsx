import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useStreamMessages, type StreamMessage } from '../../../api/stream-messages';
import { useControlPlaneApps } from '../../../api/controlplane';
import { useFilterParams } from '../../../hooks/useFilterParams';
import { DataTable, type Column } from '../../../components/common/data/DataTable';
import { StickyPagination } from '../../../components/common/data/StickyPagination';
import { FilterBar, FilterSelect, FilterInput } from '../../../components/common/data/FilterBar';
import { TimestampCell } from '../../../components/common/display/TimestampCell';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { StreamMessageDetail } from './StreamMessageDetail';
import { STATUS_DOT, STATUS_LABEL, STATUS_OPTIONS, SOURCE_OPTIONS, SOURCE_BADGE } from './constants';

export function StreamMessagesPage() {
  const { filters, setFilter, pagination, sort, setSort } = useFilterParams({
    filters: { namespace: 'durable', source: 'worker', status: '', stream_name: '', msg_type: '' },
  });

  const [selected, setSelected] = useState<StreamMessage | null>(null);

  const { data: appsData } = useControlPlaneApps();
  const namespaceOptions = useMemo(
    () => (appsData?.apps ?? []).map((a) => ({ value: a.appId, label: a.appId })),
    [appsData],
  );

  const { data, isLoading } = useStreamMessages({
    namespace: filters.namespace || 'durable',
    source: (filters.source as 'engine' | 'worker') || 'worker',
    limit: pagination.pageSize,
    offset: pagination.offset,
    sort_by: sort.sort_by || 'created_at',
    order: sort.order || 'desc',
    status: (filters.status as any) || undefined,
    stream_name: filters.stream_name || undefined,
    msg_type: filters.msg_type || undefined,
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
          <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[row.status]}`} />
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
      <PageHeader title="Stream Messages" />

      <FilterBar>
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
            <StreamMessageDetail message={activeMessage} />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
