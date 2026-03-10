import type { ReactNode } from 'react';
import { EmptyState } from './EmptyState';
import type { SortState } from '../../hooks/useFilterParams';

export interface Column<T> {
  key: string;
  label: string | ReactNode;
  render: (row: T, index: number) => ReactNode;
  className?: string;
  /** If true, this column header is clickable and triggers onSort. */
  sortable?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyFn: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Highlight the row whose keyFn matches this value. */
  activeRowKey?: string | null;
  isLoading?: boolean;
  emptyMessage?: string;
  /** Current sort state — pass to show active sort indicator. */
  sort?: SortState;
  /** Called when a sortable column header is clicked. */
  onSort?: (column: string) => void;
}

function SortIcon({ active, direction }: { active: boolean; direction: 'asc' | 'desc' }) {
  return (
    <svg
      className={`w-3 h-3 shrink-0 transition-all duration-150 ${
        active ? 'text-accent opacity-100' : 'opacity-0 group-hover/sorthead:opacity-40 text-text-tertiary'
      } ${active && direction === 'asc' ? 'rotate-180' : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

export function DataTable<T>({
  columns,
  data,
  keyFn,
  onRowClick,
  activeRowKey,
  isLoading,
  emptyMessage = 'No records found',
  sort,
  onSort,
}: DataTableProps<T>) {
  if (isLoading) {
    return (
      <div className="animate-pulse space-y-0">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-14 border-b last:border-b-0 px-6 flex items-center">
            <div className="h-3 bg-surface-sunken rounded w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (!data.length) {
    return <EmptyState title={emptyMessage} />;
  }

  return (
    <table className="w-full">
      <thead>
        <tr className="border-b">
          {columns.map((col) => {
            const isSortable = col.sortable && onSort;
            const isActive = sort?.sort_by === col.key;

            return (
              <th
                key={col.key}
                onClick={isSortable ? () => onSort(col.key) : undefined}
                className={`sticky top-[2.75rem] z-10 bg-surface px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-tertiary ${col.className ?? ''} ${
                  isSortable ? 'cursor-pointer select-none group/sorthead hover:text-text-secondary transition-colors' : ''
                }`}
              >
                <span className="inline-flex items-center gap-1">
                  {col.label}
                  {isSortable && (
                    <SortIcon active={isActive} direction={isActive ? sort.order : 'desc'} />
                  )}
                </span>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {data.map((row, index) => {
          const isActive = activeRowKey != null && keyFn(row) === activeRowKey;
          return (
          <tr
            key={keyFn(row)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={`group/row border-b last:border-b-0 transition-colors duration-100 ${
              onRowClick ? 'cursor-pointer row-hover' : ''
            } ${isActive ? 'bg-accent/5 border-l-2 border-l-accent' : ''}`}
          >
            {columns.map((col) => (
              <td
                key={col.key}
                className={`px-6 py-3.5 text-sm ${col.className ?? ''}`}
              >
                {col.render(row, index)}
              </td>
            ))}
          </tr>
          );
        })}
      </tbody>
    </table>
  );
}
