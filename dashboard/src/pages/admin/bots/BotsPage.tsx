import { useState, useMemo } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { useBots, useDeleteBot } from '../../../api/bots';
import { useFilterParams } from '../../../hooks/useFilterParams';
import { DataTable, type Column } from '../../../components/common/data/DataTable';
import { StickyPagination } from '../../../components/common/data/StickyPagination';
import { FilterBar, FilterSelect, FilterInput } from '../../../components/common/data/FilterBar';
import { ConfirmDeleteModal } from '../../../components/common/modal/ConfirmDeleteModal';
import { RowAction, RowActionGroup } from '../../../components/common/layout/RowActions';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { RolePill } from '../../../components/common/display/RolePill';
import { DateValue } from '../../../components/common/display/DateValue';
import type { BotRecord } from '../../../api/types';
import { CreateBotModal } from './CreateBotModal';
import { EditBotModal } from './EditBotModal';
import { BotDetailPanel } from './BotDetailPanel';

const statusDot: Record<string, string> = {
  active: 'bg-status-success',
  inactive: 'bg-text-tertiary',
  suspended: 'bg-status-error',
};

const statusOptions = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'suspended', label: 'Suspended' },
];

export function BotsPage({ embedded = false }: { embedded?: boolean }) {
  // Same filter surface as the User Accounts tab: search + status, both
  // URL-driven and resolved server-side (never a client-side pass over a
  // paginated page).
  const { filters, setFilter, pagination } = useFilterParams({
    filters: { status: '', search: '' },
  });
  const deleteBot = useDeleteBot();

  const [showCreate, setShowCreate] = useState(false);
  const [editingBot, setEditingBot] = useState<BotRecord | null>(null);
  const [selectedBot, setSelectedBot] = useState<BotRecord | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<BotRecord | null>(null);

  const { data, isLoading } = useBots({
    status: filters.status || undefined,
    search: filters.search || undefined,
    limit: pagination.pageSize,
    offset: pagination.offset,
  });

  const total = data?.total ?? 0;
  const bots = data?.bots ?? [];

  const activeBot = useMemo(() => {
    if (!selectedBot) return null;
    return bots.find((b) => b.id === selectedBot.id) ?? selectedBot;
  }, [bots, selectedBot]);

  const columns: Column<BotRecord>[] = [
    {
      key: 'display_name',
      label: 'Service Account',
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <span
            className={`w-2 h-2 rounded-full dot-ring shrink-0 ${statusDot[row.status] ?? 'bg-status-pending'}`}
            title={row.status}
          />
          <span className="text-sm text-text-primary whitespace-nowrap">
            {row.display_name || row.external_id}
          </span>
        </div>
      ),
    },
    {
      key: 'description',
      label: 'Description',
      render: (row) => (
        <span
          className="block max-w-[32rem] truncate text-xs text-text-tertiary"
          title={row.description ?? undefined}
        >
          {row.description ?? ''}
        </span>
      ),
    },
    {
      key: 'roles',
      label: 'Roles',
      render: (row) => (
        <div className="flex gap-1 flex-wrap">
          {(row.roles ?? []).map((r) => (
            <RolePill key={r.role} role={r.role} />
          ))}
        </div>
      ),
    },
    {
      key: 'created_at',
      label: 'Created',
      render: (row) => <DateValue date={row.created_at} />,
      className: 'w-36 whitespace-nowrap',
    },
    {
      key: 'actions',
      label: '',
      render: (row) => (
        <RowActionGroup>
          <RowAction
            icon={Pencil}
            title="Edit service account"
            onClick={() => setEditingBot(row)}
          />
          <RowAction
            icon={Trash2}
            title="Delete service account"
            onClick={() => setConfirmDelete(row)}
            colorClass="text-text-tertiary hover:text-status-error"
          />
        </RowActionGroup>
      ),
      className: 'w-16 text-right',
    },
  ];

  const handleDelete = () => {
    if (!confirmDelete) return;
    deleteBot.mutate(confirmDelete.id, {
      onSuccess: () => {
        setConfirmDelete(null);
        if (selectedBot?.id === confirmDelete.id) setSelectedBot(null);
      },
    });
  };

  return (
    <div>
      {embedded ? (
        <div className="flex justify-end mb-4">
          <button onClick={() => setShowCreate(true)} className="btn-primary text-xs">
            Add Service Account
          </button>
        </div>
      ) : (
        <PageHeader
          title="Service Accounts"
          actions={
            <button onClick={() => setShowCreate(true)} className="btn-primary text-xs">
              Add Service Account
            </button>
          }
        />
      )}

      <FilterBar>
        <FilterInput
          label="Search"
          value={filters.search}
          onChange={(v) => setFilter('search', v)}
          placeholder="name, id, description…"
        />
        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(v) => setFilter('status', v)}
          options={statusOptions}
        />
      </FilterBar>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">
        <div className="overflow-x-clip">
          <DataTable
            columns={columns}
            data={bots}
            keyFn={(row) => row.id}
            isLoading={isLoading}
            emptyMessage="No service accounts yet"
            onRowClick={(row) => setSelectedBot(row)}
            activeRowKey={activeBot?.id ?? null}
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

        <div className="sticky top-4">
          <BotDetailPanel bot={activeBot} />
        </div>
      </div>

      <CreateBotModal open={showCreate} onClose={() => setShowCreate(false)} />

      <EditBotModal
        open={!!editingBot}
        onClose={() => setEditingBot(null)}
        bot={editingBot}
      />

      <ConfirmDeleteModal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title="Delete Service Account"
        description={
          <>
            Delete{' '}
            <span className="font-medium text-text-primary">
              {confirmDelete?.display_name || confirmDelete?.external_id}
            </span>
            ? This will also revoke all API keys. This action cannot be undone.
          </>
        }
        isPending={deleteBot.isPending}
        error={deleteBot.error as Error | null}
      />
    </div>
  );
}
