import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { interpolateHelp } from '../../../lib/x-lt-help';
import { DataTable, type Column as TableColumn } from '../../common/data/DataTable';
import { FormattedValue, EM_DASH } from '../../common/display/FormattedValue';
import { RefineDialog } from '../RefineDialog';
import { useRelatedAggregates } from '../../../api/escalation-related';
import { useRelatedSetEvents } from '../../../hooks/useEventHooks';
import { metadataFacetsUrl } from '../../../lib/facet-url';
import {
  readListSchemaRelations,
  relatedAggregateKey,
  resolveRelatedFacets,
  rowTemplateContext,
  type GroupFold,
  type ListSchemaRelations,
  type RelatedColumnDecl,
  type RelatedSetResult,
} from '../../../lib/list-schema';
import {
  escalationDotClass,
  rowContext,
  rowRefinePairs,
  RowActionButton,
  RefineTrigger,
  IDENTITY_COLUMN_WIDTH,
  actionColumnWidth,
  type ColumnDef,
  type RowActionDef,
} from './row-parts';
import { RelatedCell } from './RelatedCell';
import { RowDetail } from './RowDetail';
import { buildTableRows, foldColumnText, mergeAggregates, withOpenMembers, type EscalationGroup, type TableRow } from './group-rows';
import type { LTEscalationRecord } from '../../../api/types';

export type { EscalationGroup } from './group-rows';

/** A plain column (a `value` template) or a related column (a `related` set). */
type TableColumnDecl = ColumnDef & Partial<Omit<RelatedColumnDecl, 'label'>> & { group?: GroupFold };

export interface FacetTableSchema {
  'x-lt-columns'?: Array<ColumnDef | (Omit<ColumnDef, 'value'> & RelatedColumnDecl)>;
  'x-lt-row-action'?: RowActionDef;
  [key: string]: unknown;
}

/** One member per distinct resolved facet match (members whose facets do not resolve stay). */
function distinctByMatch(members: LTEscalationRecord[], facets: Record<string, unknown>, narrow?: Record<string, unknown>): LTEscalationRecord[] {
  const seen = new Set<string>();
  return members.filter((m) => {
    const match = resolveRelatedFacets(facets, rowTemplateContext(m as unknown as Record<string, unknown>), narrow);
    if (!match) return true;
    const key = JSON.stringify(match);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The related declaration, or none when the stored schema does not validate. */
function safeRelations(schema: FacetTableSchema): ListSchemaRelations | null {
  try {
    return readListSchemaRelations(schema);
  } catch {
    return null;
  }
}

/**
 * The pending queue as a facet table. Plain columns template over each row;
 * related columns aggregate the row's related sets (one request per page);
 * a declared row detail expands each row into its related rows; grouped
 * rows fold their columns and expand to their members.
 */
interface FacetTableProps {
  schema: FacetTableSchema;
  rows: LTEscalationRecord[];
  /** Grouped reads: the page's groups, in order. */
  groups?: EscalationGroup[] | null;
  role: string;
  /** The list schema version the page rendered. */
  version?: number | null;
  onRowClick?: (row: LTEscalationRecord) => void;
  /** RefineDialog "Add to filters": merge into the live filter set. */
  onAddFacet?: (key: string, value: unknown) => void;
  forceView?: boolean;
}

/** Reads the page's related sets and keeps them live; mounted only when the schema declares sets. */
function RelatedFacetTable(props: FacetTableProps & { relations: ListSchemaRelations }) {
  const related = useRelatedAggregates(props.role, props.rows.map((r) => r.id), props.version);
  const sets = related.data?.sets ?? {};
  useRelatedSetEvents(Object.values(sets).flatMap((set) => set.roles ?? []));
  return <FacetTableBody {...props} sets={sets} setsLoading={related.isLoading} />;
}

export function FacetTable(props: FacetTableProps) {
  const relations = useMemo(() => safeRelations(props.schema), [props.schema]);
  return relations && Object.keys(relations.sets).length > 0
    ? <RelatedFacetTable {...props} relations={relations} />
    : <FacetTableBody {...props} relations={relations} sets={{}} setsLoading={false} />;
}

function FacetTableBody({ schema, rows, groups, role, version, onRowClick, onAddFacet, forceView, relations, sets, setsLoading }: FacetTableProps & {
  relations: ListSchemaRelations | null;
  sets: Record<string, RelatedSetResult>;
  setsLoading: boolean;
}) {
  const navigate = useNavigate();
  const columnDefs = (schema['x-lt-columns'] ?? []) as TableColumnDecl[];
  const rowAction = schema['x-lt-row-action'];
  const sections = relations?.rowDetail ?? [];
  const [refineRow, setRefineRow] = useState<LTEscalationRecord | null>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  const tableRows = useMemo(() => buildTableRows(rows, groups), [rows, groups]);
  const lines = useMemo(() => withOpenMembers(tableRows, open), [tableRows, open]);
  const grouped = !!groups;
  const expandable = sections.length > 0 || grouped;
  // A row opens when it has something beneath it: a group its members, a row its detail.
  const opens = (r: TableRow) => r.rows.length > 1 || sections.length > 0;

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  const relatedCell = (col: TableColumnDecl, members: LTEscalationRecord[]) => {
    const name = col.related!;
    const set = sets[name];
    const query = relations?.sets[name]?.query;
    // Members that share a facet match read the same related rows: count them once.
    const counted = query?.facets ? distinctByMatch(members, query.facets, query.narrow) : members;
    const key = relatedAggregateKey(col as RelatedColumnDecl, relations?.sets[name]?.source ?? '');
    const agg = mergeAggregates(counted.map((m) => set?.aggregates[key]?.[m.id]), (col as RelatedColumnDecl).aggregate);
    const drillUrl = query?.facets && members.length === 1
      ? (relatedRole: string) => {
          const match = resolveRelatedFacets(query.facets!, rowTemplateContext(members[0] as unknown as Record<string, unknown>), query.narrow);
          return match ? metadataFacetsUrl(match, relatedRole) : null;
        }
      : undefined;
    return <RelatedCell col={col as RelatedColumnDecl} set={set} agg={setsLoading ? undefined : agg} drillUrl={drillUrl} />;
  };

  // The authored columns render through the same dense table the engineer
  // views use: the card fold at narrow widths, never a horizontal scroll.
  // Authors steer the fold with `priority` (1 title, 2 folds, 3 dropped).
  const actionLabel = rowAction?.label ?? (forceView ? 'View' : 'Claim');
  const lead = (r: TableRow) => r.rows[0];
  const columns: TableColumn<TableRow>[] = [
    ...(expandable ? [{
      key: '_expand',
      label: '',
      priority: 1 as const,
      className: 'w-12 px-1',
      render: (r: TableRow) => (
        // A member's chevron steps in under its group's, so depth reads at a glance.
        <span className={`flex ${r.depth ? 'pl-5' : ''}`}>
          {opens(r) && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); toggle(r.key); }}
              className="p-1 rounded icon-link hover:bg-surface-hover transition-colors"
              aria-expanded={open.has(r.key)}
              aria-label={open.has(r.key) ? 'Collapse row' : 'Expand row'}
              data-testid="row-expand"
            >
              <ChevronRight className={`w-3.5 h-3.5 transition-transform ${open.has(r.key) ? 'rotate-90' : ''}`} strokeWidth={1.75} />
            </button>
          )}
        </span>
      ),
    }] : []),
    {
      key: '_status',
      label: '',
      priority: 1,
      className: 'w-8',
      render: (r) => (
        <span className="inline-flex items-center gap-1">
          <span className={`w-2.5 h-2.5 inline-block rounded-full dot-ring ${escalationDotClass(lead(r))}`} title={lead(r).status} />
          {r.rows.length > 1 && (
            <span className="text-2xs tabular-nums text-text-tertiary" title={`${r.rows.length} rows in this group`} data-testid="group-size">
              {r.rows.length}
            </span>
          )}
        </span>
      ),
    },
    ...columnDefs.map((col, i): TableColumn<TableRow> => ({
      key: `col-${i}`,
      label: col.label,
      priority: col.priority ?? (i === 0 ? 1 : 2),
      width: col.width ?? (i === 0 && !columnDefs.some((c) => c.width) ? IDENTITY_COLUMN_WIDTH : undefined),
      render: (r) => {
        if (col.related) return relatedCell(col, r.rows);
        const text = r.rows.length > 1 ? foldColumnText(col, r.rows) : interpolateHelp(col.value, rowContext(lead(r)));
        // A member shows only what differs from its group: the group line already states the rest.
        if (r.parent && text === foldColumnText(col, r.parent.rows)) return null;
        // The identity steps in for a member, so the tree reads in the data too.
        const indent = i === 0 && r.depth ? 'pl-4' : '';
        return (
          <span className={`block truncate ${indent}`} title={text && text !== EM_DASH ? text : undefined}>
            <FormattedValue raw={text} format={col.format} />
          </span>
        );
      },
    })),
    {
      key: '_refine',
      label: '',
      priority: 1,
      className: 'w-8 px-1',
      render: (r) =>
        r.rows.length === 1 && rowRefinePairs(lead(r), columnDefs).length > 0
          ? <RefineTrigger onOpen={() => setRefineRow(lead(r))} />
          : null,
    },
    {
      // The action column sizes to its label so the button never wraps.
      key: '_action',
      label: '',
      priority: 1,
      width: actionColumnWidth(actionLabel),
      className: 'text-right whitespace-nowrap',
      render: (r) => r.rows.length === 1
        ? <RowActionButton row={lead(r)} def={rowAction} onView={() => onRowClick?.(lead(r))} forceView={forceView} />
        : null,
    },
  ];

  // Containment by depth: an open line takes a light band, its members a
  // stronger band stepped in under it, and a row's detail the band of its
  // row, indented past it. No rules: indentation and value carry the tree.
  const rowClassName = (r: TableRow) => {
    if (r.depth) return 'bg-surface-sunken border-b-surface-border/40';
    return open.has(r.key) && opens(r) ? 'bg-surface-sunken/50 border-b-surface-border/40' : '';
  };

  const renderExpansion = (r: TableRow) => {
    if (!open.has(r.key) || r.rows.length > 1 || sections.length === 0) return null;
    return (
      <div
        onClick={(e) => e.stopPropagation()}
        className={`${r.depth ? 'bg-surface-sunken pl-20' : 'bg-surface-sunken/50 pl-12'} pr-3 pt-1 pb-4`}
        data-testid="row-detail-block"
      >
        <RowDetail role={role} host={lead(r)} version={version} sections={sections} />
      </div>
    );
  };

  return (
    <>
      <DataTable
        columns={columns}
        data={lines}
        layout="fixed"
        density="dense"
        keyFn={(r) => r.key}
        onRowClick={onRowClick ? (r) => (r.rows.length === 1 ? onRowClick(lead(r)) : toggle(r.key)) : undefined}
        rowClassName={expandable ? rowClassName : undefined}
        emptyMessage="No pending items."
        renderExpansion={expandable ? renderExpansion : undefined}
      />
      <RefineDialog
        open={!!refineRow}
        onClose={() => setRefineRow(null)}
        role={role}
        pairs={refineRow ? rowRefinePairs(refineRow, columnDefs) : []}
        onNavigate={navigate}
        onAddFacet={onAddFacet}
      />
    </>
  );
}
