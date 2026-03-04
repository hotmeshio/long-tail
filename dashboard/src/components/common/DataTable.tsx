import type { ReactNode } from 'react';
import { EmptyState } from './EmptyState';

export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyFn: (row: T) => string;
  onRowClick?: (row: T) => void;
  isLoading?: boolean;
  emptyMessage?: string;
}

export function DataTable<T>({
  columns,
  data,
  keyFn,
  onRowClick,
  isLoading,
  emptyMessage = 'No records found',
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
          {columns.map((col) => (
            <th
              key={col.key}
              className={`sticky top-[2.75rem] z-10 bg-surface px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-tertiary ${col.className ?? ''}`}
            >
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((row) => (
          <tr
            key={keyFn(row)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={`border-b last:border-b-0 transition-colors duration-100 ${
              onRowClick ? 'cursor-pointer hover:bg-surface-sunken' : ''
            }`}
          >
            {columns.map((col) => (
              <td
                key={col.key}
                className={`px-6 py-3.5 text-sm ${col.className ?? ''}`}
              >
                {col.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
