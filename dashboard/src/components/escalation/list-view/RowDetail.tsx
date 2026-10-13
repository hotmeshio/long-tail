import { useNavigate } from 'react-router-dom';
import { DataTable, type Column } from '../../common/data/DataTable';
import { FormattedValue, EM_DASH } from '../../common/display/FormattedValue';
import { useRelatedRows } from '../../../api/escalation-related';
import { interpolateItemTemplate, type EscalationItem } from '../../../lib/escalation-items';
import { displayRoleTitle } from '../../../lib/role-display';
import type { RelatedRow, RowDetailSectionDecl } from '../../../lib/list-schema';
import { rowContext } from './row-parts';
import type { LTEscalationRecord } from '../../../api/types';

/** `format: "role"` renders a role name as its title. */
const ROLE_FORMAT = 'role';

function cellText(template: string, row: RelatedRow): string {
  const ctx = row.escalation ? rowContext(row.escalation as unknown as LTEscalationRecord) : {};
  return interpolateItemTemplate(template, row.item as EscalationItem | undefined, ctx);
}

function DetailSection({ role, host, version, section, roleLabels }: {
  role: string;
  host: LTEscalationRecord;
  version: number | null | undefined;
  section: RowDetailSectionDecl;
  roleLabels?: Record<string, string>;
}) {
  const navigate = useNavigate();
  const query = useRelatedRows(role, host.id, section.related, version, section.limit);
  const rows = query.data?.rows ?? [];
  const labels = query.data?.roleLabels ?? roleLabels ?? {};
  const restricted = query.data?.restricted ?? [];

  // A column whose every row restates a facet the opened row carries says
  // nothing new beneath it: the row already shows that facet.
  const hostValues = new Set(
    Object.values(host.metadata ?? {})
      .filter((v) => (typeof v === 'string' && v !== '') || typeof v === 'number' || typeof v === 'boolean')
      .map(String),
  );
  const shown = section.columns.filter((col, i) => {
    // The first column names each row; it always stays.
    if (i === 0 || rows.length === 0) return true;
    const values = new Set(rows.map((row) => cellText(col.value, row)));
    return !(values.size === 1 && hostValues.has([...values][0]));
  });

  const columns: Column<RelatedRow>[] = shown.map((col, i) => ({
    key: `d-${i}`,
    label: col.label,
    priority: col.priority ?? (i === 0 ? 1 : 2),
    render: (row) => {
      const text = cellText(col.value, row);
      if (col.format === ROLE_FORMAT && text !== EM_DASH) {
        return <span className="block truncate">{labels[text] ?? displayRoleTitle({ role: text })}</span>;
      }
      return (
        <span className="block truncate" title={text !== EM_DASH ? text : undefined}>
          <FormattedValue raw={text} format={col.format} />
        </span>
      );
    },
  }));

  const target = (row: RelatedRow): string | null =>
    (row.escalation?.id as string | undefined) ?? row.item?.reciprocalId ?? null;

  return (
    <div data-testid="row-detail-section">
      <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary pt-3 pb-1">
        {section.label ?? section.related}
        {query.data && <span className="ml-2 font-normal normal-case tracking-normal tabular-nums">{query.data.total}</span>}
      </p>
      {query.isLoading ? (
        <p className="text-2xs text-text-tertiary italic pb-2">Loading…</p>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          keyFn={(row) => row.item?.itemKey ?? String(row.escalation?.id)}
          onRowClick={(row) => {
            const id = target(row);
            if (id) navigate(`/escalations/detail/${id}`);
          }}
          layout="fixed"
          density="compact"
          inline
          emptyMessage=""
        />
      )}
      {!query.isLoading && rows.length === 0 && (
        <p className="text-2xs text-text-quaternary italic pb-2">None.</p>
      )}
      {query.data && query.data.total > rows.length && (
        <p className="text-2xs text-text-quaternary pb-2">Showing {rows.length} of {query.data.total}.</p>
      )}
      {restricted.length > 0 && (
        <p className="text-2xs text-text-quaternary italic pb-2">
          Not shown (outside your view): {restricted.map((r) => labels[r] ?? r).join(', ')}
        </p>
      )}
    </div>
  );
}

/** A host row's declared detail sections, each loaded when the row opens. */
export function RowDetail({ role, host, version, sections }: {
  role: string;
  host: LTEscalationRecord;
  version: number | null | undefined;
  sections: RowDetailSectionDecl[];
}) {
  return (
    <div className="space-y-1" data-testid="row-detail">
      {sections.map((section, i) => (
        <DetailSection key={i} role={role} host={host} version={version} section={section} />
      ))}
    </div>
  );
}
