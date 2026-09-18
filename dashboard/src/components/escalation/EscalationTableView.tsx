import { useMemo } from 'react';
import { DataTable } from '../common/data/DataTable';
import { makeEscalationColumns } from '../../pages/operator/escalation-columns';
import type { LTEscalationRecord } from '../../api/types';
import { LIST_LAYOUTS, type ListLayout } from '../../lib/escalation-list-url';

/** The fold policy and density a `?layout=` value asks of the table. */
export function tableLayoutProps(layout: ListLayout | null | undefined): { fold: 'auto' | 'never' | 'always'; density: 'default' | 'compact' } {
  if (layout === LIST_LAYOUTS.COMPACT) return { fold: 'never', density: 'compact' };
  if (layout === LIST_LAYOUTS.CARDS) return { fold: 'always', density: 'default' };
  return { fold: 'auto', density: 'default' };
}

/**
 * The escalations table as a plain reading surface: the shared column set,
 * no selection or claim controls, header in the flow so it sits well inside
 * a panel that scrolls on its own. `layout` is the URL's `?layout=` hint:
 * `compact` stays a tight table however narrow, `cards` always folds.
 */
export function EscalationTableView({
  escalations,
  highlightKeys,
  onRowClick,
  isLoading,
  emptyMessage = 'No escalations',
  layout,
}: {
  escalations: LTEscalationRecord[];
  highlightKeys?: string[];
  onRowClick?: (row: LTEscalationRecord) => void;
  isLoading?: boolean;
  emptyMessage?: string;
  layout?: ListLayout | null;
}) {
  const columns = useMemo(() => makeEscalationColumns({ highlightKeys }), [highlightKeys]);
  return (
    <DataTable
      columns={columns}
      data={escalations}
      layout="fixed"
      {...tableLayoutProps(layout)}
      inline
      keyFn={(row) => row.id}
      onRowClick={onRowClick}
      isLoading={isLoading}
      emptyMessage={emptyMessage}
    />
  );
}
