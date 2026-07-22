import { Fragment, type ReactNode } from 'react';
import { EmptyState } from '../display/EmptyState';
import { useContainerWidth } from '../../../hooks/useContainerWidth';
import type { SortState } from '../../../hooks/useFilterParams';

export interface Column<T> {
  key: string;
  label: string | ReactNode;
  render: (row: T, index: number) => ReactNode;
  className?: string;
  /** If true, this column header is clickable and triggers onSort. */
  sortable?: boolean;
  /**
   * Card-fold behavior when the container drops below the @table threshold:
   * 1 = identity — always visible, forms the card's title line;
   * 2 = folds into the card body as a label/value pair (default);
   * 3 = dropped in card mode.
   */
  priority?: 1 | 2 | 3;
  /**
   * Table-mode disclosure: the column renders only when the table's
   * container clears the named threshold. The column budget governs the
   * floor; enrichment columns return with room.
   */
  showFrom?: 'split' | 'wall';
}

/* Literal class strings so Tailwind's scanner sees the container variants. */
const SHOW_FROM_CLASS: Record<NonNullable<Column<unknown>['showFrom']>, string> = {
  split: 'hidden @split/table:table-cell',
  wall: 'hidden @wall/table:table-cell',
};

/**
 * Split columns by card-fold priority. When NO column declares a priority,
 * the first column is the identity and the rest fold — the sane default for
 * every list page. When any column declares one, undeclared columns fold.
 * Exported for tests.
 */
export function partitionColumns<T>(columns: Column<T>[]): {
  identity: Column<T>[];
  meta: Column<T>[];
  dropped: Column<T>[];
} {
  const anyDeclared = columns.some((c) => c.priority !== undefined);
  const identity: Column<T>[] = [];
  const meta: Column<T>[] = [];
  const dropped: Column<T>[] = [];
  columns.forEach((col, i) => {
    const priority = col.priority ?? (anyDeclared ? 2 : i === 0 ? 1 : 2);
    if (priority === 1) identity.push(col);
    else if (priority === 3) dropped.push(col);
    else meta.push(col);
  });
  return { identity, meta, dropped };
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyFn: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Highlight the row whose keyFn matches this value. */
  activeRowKey?: string | null;
  /** Optional per-row class name for custom styling (e.g., engine vs worker tint). */
  rowClassName?: (row: T) => string;
  isLoading?: boolean;
  emptyMessage?: string;
  /** Current sort state — pass to show active sort indicator. */
  sort?: SortState;
  /** Called when a sortable column header is clicked. */
  onSort?: (column: string) => void;
  /** Disable the sticky header (useful when nested inside collapsible sections). */
  inline?: boolean;
  /**
   * `fixed` locks the table to its container width: columns with width
   * classes keep them, the rest share the remainder, and long content
   * truncates instead of widening the table. Use beside a slide panel where
   * the table must shrink as the panel expands.
   */
  layout?: 'auto' | 'fixed';
  /** Force console-card rendering regardless of measured width (tests). */
  forceCardMode?: boolean;
}

/** The @table threshold in rem — below this the table folds into cards. */
const CARD_FOLD_REM = 48;

function rootFontPx(): number {
  if (typeof window === 'undefined' || typeof document === 'undefined') return 16;
  const size = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(size) && size > 0 ? size : 16;
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

/** Compact sort control for card mode, where there is no header row. */
function CardSortControl<T>({ columns, sort, onSort }: {
  columns: Column<T>[];
  sort?: SortState;
  onSort: (column: string) => void;
}) {
  const sortable = columns.filter((c) => c.sortable);
  if (sortable.length === 0) return null;
  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b">
      <span className="text-2xs font-semibold uppercase tracking-wide text-text-tertiary">Sort</span>
      <select
        className="select text-2xs py-1"
        value={sort?.sort_by ?? ''}
        onChange={(e) => e.target.value && onSort(e.target.value)}
      >
        {!sort?.sort_by && <option value="" disabled>Choose…</option>}
        {sortable.map((c) => (
          <option key={c.key} value={c.key}>{typeof c.label === 'string' ? c.label : c.key}</option>
        ))}
      </select>
      {sort?.sort_by && (
        <button
          onClick={() => onSort(sort.sort_by)}
          className="text-2xs text-text-tertiary hover:text-accent transition-colors tabular-nums"
          title="Flip sort direction"
        >
          {sort.order === 'asc' ? '↑ asc' : '↓ desc'}
        </button>
      )}
    </div>
  );
}

export function DataTable<T>({
  columns,
  data,
  keyFn,
  onRowClick,
  activeRowKey,
  rowClassName,
  isLoading,
  emptyMessage = 'No records found',
  sort,
  onSort,
  inline,
  layout = 'auto',
  forceCardMode,
}: DataTableProps<T>) {
  const [wrapRef, width] = useContainerWidth<HTMLDivElement>();
  const cardMode = forceCardMode ?? (width !== null && width < CARD_FOLD_REM * rootFontPx());

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
    return emptyMessage ? <EmptyState title={emptyMessage} /> : null;
  }

  if (cardMode) {
    // A table row IS a dictionary: identity columns form the title line, the
    // rest fold into dense console-style pairs. Tables never scroll
    // horizontally — they fold.
    const { identity, meta } = partitionColumns(columns);
    // The title line: glyph/width-classed identity columns (status dots,
    // checkboxes, countdowns) hold their size; the first free-width identity
    // column (the description) flexes and truncates.
    const flexAt = Math.max(0, identity.findIndex((c) => !/(^|\s)w-\d/.test(c.className ?? '')));
    return (
      <div ref={wrapRef} className="@container/table">
        {onSort && <CardSortControl columns={columns} sort={sort} onSort={onSort} />}
        <div className="divide-y divide-surface-border">
          {data.map((row, index) => {
            const isActive = activeRowKey != null && keyFn(row) === activeRowKey;
            return (
              <div
                key={keyFn(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`py-3 px-4 transition-colors duration-100 ${
                  onRowClick ? 'cursor-pointer row-hover' : ''
                } ${isActive ? 'border-l-2 border-l-accent' : ''} ${rowClassName ? rowClassName(row) : ''}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {identity.map((col, i) => (
                    <div key={col.key} className={i === flexAt ? 'flex-1 min-w-0' : 'shrink-0'}>
                      {col.render(row, index)}
                    </div>
                  ))}
                </div>
                {meta.length > 0 && (
                  <dl className="mt-2 grid grid-cols-1 @dict-inline/table:grid-cols-[max-content_1fr] gap-x-6 gap-y-1 items-baseline">
                    {meta.map((col) => (
                      <Fragment key={col.key}>
                        <dt className="text-2xs font-semibold uppercase tracking-wide text-text-tertiary">
                          {col.label}
                        </dt>
                        <dd className="text-sm min-w-0 break-words">{col.render(row, index)}</dd>
                      </Fragment>
                    ))}
                  </dl>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="@container/table">
      <table className={`w-full ${layout === 'fixed' ? 'table-fixed' : ''}`}>
        <thead>
          <tr className="border-b">
            {columns.map((col) => {
              const isSortable = col.sortable && onSort;
              const isActive = sort?.sort_by === col.key;

              return (
                <th
                  key={col.key}
                  onClick={isSortable ? () => onSort(col.key) : undefined}
                  className={`${inline ? '' : 'sticky top-[60px] z-10 '}bg-surface px-6 py-3 text-left text-2xs font-semibold uppercase tracking-widest text-text-tertiary whitespace-nowrap ${col.showFrom ? SHOW_FROM_CLASS[col.showFrom] : ''} ${col.className ?? ''} ${
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
              } ${isActive ? 'border-l-2 border-l-accent' : ''} ${rowClassName ? rowClassName(row) : ''}`}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`px-6 py-2.5 text-sm ${col.showFrom ? SHOW_FROM_CLASS[col.showFrom] : ''} ${col.className ?? ''}`}
                >
                  {col.render(row, index)}
                </td>
              ))}
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
