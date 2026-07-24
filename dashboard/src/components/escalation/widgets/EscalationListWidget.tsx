import { Link } from 'react-router-dom';
import { interpolateHelp } from '../../../lib/x-lt-help';
import { formatAgoCompact } from '../../../lib/format';
import { rowContext } from '../EscalationListView';
import { useEscalations } from '../../../api/escalations';
import { FieldLabel, FieldHelper } from '../resolver-form/FieldChrome';
import type { WidgetProps } from './index';
import type { ShowIfContext } from '../../../lib/x-lt-show-if';
import type { LTEscalationRecord } from '../../../api/types';

interface ColumnDef { label: string; value: string; format?: string }

interface EmbedQuery {
  role?: string;
  status?: string;
  facets?: Record<string, string>;
  limit?: number;
  available?: boolean;
}

const DEFAULT_COLUMNS: ColumnDef[] = [
  { label: 'Description', value: '{{escalation.description}}' },
  { label: 'Role', value: '{{escalation.role}}' },
  { label: 'Age', value: '{{escalation.created_at}}', format: 'age' },
];

const EM_DASH = '—';

/** Interpolate `{{domain.path}}` tokens in every string value of the facets map. */
function resolveQueryFacets(
  facets: Record<string, string> | undefined,
  ctx: ShowIfContext,
): Record<string, unknown> {
  if (!facets) return {};
  const resolved: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(facets)) {
    resolved[k] = typeof v === 'string' ? interpolateHelp(v, ctx) : v;
  }
  return resolved;
}

function renderValue(raw: string, format?: string): string {
  if (!raw || raw === EM_DASH) return EM_DASH;
  if (format === 'age') {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? raw : formatAgoCompact(raw);
  }
  return raw;
}

/**
 * Escalation list widget — embeds a compact list of escalations inline in the
 * form, driven by a facet query declared in `x-lt-query`. String values inside
 * `x-lt-query.facets` support `{{domain.path}}` token interpolation.
 *
 * Schema usage:
 *   "x-lt-widget": "escalation-list"
 *   "x-lt-query": {
 *     "role": "rel-originator",
 *     "facets": { "customerId": "{{metadata.customerId}}" },
 *     "status": "pending",
 *     "limit": 5
 *   }
 *   "x-lt-columns": [                              (optional)
 *     { "label": "Order", "value": "{{metadata.orderId}}" },
 *     { "label": "Age",   "value": "{{escalation.created_at}}", "format": "age" }
 *   ]
 *   "title": "List heading"
 *   "description": "One-line instruction text"
 *
 * Column `value` strings use the same `{{domain.path}}` token convention as
 * `x-lt-active.fields` and `x-lt-columns` in list schemas — tokens resolve
 * against each displayed escalation's own row context.
 *
 * When `x-lt-columns` is absent, falls back to three default columns:
 * description, role, age.
 *
 * Display-only — produces no resolver payload and must not appear in `required`.
 */
export function EscalationListWidget({ fieldKey, schema, escalationContext }: WidgetProps) {
  const rawQuery = (schema?.['x-lt-query'] as EmbedQuery | undefined) ?? {};
  const columns = (schema?.['x-lt-columns'] as ColumnDef[] | undefined) ?? DEFAULT_COLUMNS;
  const label = (schema?.title as string | undefined) ?? 'Related items';
  const helperText = schema?.description as string | undefined;

  const ctx = escalationContext ?? {};
  const resolvedFacets = resolveQueryFacets(rawQuery.facets, ctx);

  const { data, isLoading } = useEscalations({
    role: rawQuery.role,
    status: rawQuery.status,
    facets: resolvedFacets,
    available: rawQuery.available,
    limit: rawQuery.limit ?? 5,
    enabled: !!(rawQuery.role || Object.keys(resolvedFacets).length),
  });

  const escalations = data?.escalations ?? [];

  return (
    <div data-field-key={fieldKey}>
      <FieldLabel>{label}</FieldLabel>
      {helperText && <FieldHelper>{helperText}</FieldHelper>}
      <div className="mt-1" data-testid={`escalation-list-widget-${fieldKey}`}>
        {isLoading ? (
          <ListSkeleton columns={columns.length} />
        ) : (
          <EmbedTable escalations={escalations} columns={columns} fieldKey={fieldKey} />
        )}
      </div>
    </div>
  );
}

function EmbedTable({
  escalations,
  columns,
  fieldKey,
}: {
  escalations: LTEscalationRecord[];
  columns: ColumnDef[];
  fieldKey: string;
}) {
  if (escalations.length === 0) {
    return (
      <p className="text-xs text-text-quaternary italic py-1" data-testid={`escalation-list-empty-${fieldKey}`}>
        No items found
      </p>
    );
  }

  return (
    <table className="w-full text-xs border-collapse" data-testid={`escalation-list-table-${fieldKey}`}>
      <thead>
        <tr className="border-b border-surface-border">
          {columns.map((col) => (
            <th
              key={col.label}
              className="text-left text-2xs font-semibold uppercase tracking-wider text-text-tertiary pb-1 pr-3 last:pr-0"
            >
              {col.label}
            </th>
          ))}
          <th className="w-4" />
        </tr>
      </thead>
      <tbody>
        {escalations.map((esc) => {
          const ctx = rowContext(esc);
          return (
            <tr
              key={esc.id}
              className="border-b border-surface-border/50 last:border-0 hover:bg-surface-sunken/50 transition-colors"
            >
              {columns.map((col) => {
                const raw = interpolateHelp(col.value, ctx);
                const display = renderValue(raw, col.format);
                return (
                  <td key={col.label} className="py-1 pr-3 last:pr-0 text-text-primary align-top">
                    {display}
                  </td>
                );
              })}
              <td className="py-1 align-top">
                <Link
                  to={`/escalations/detail/${esc.id}`}
                  className="text-accent hover:text-accent-hover transition-colors"
                  title="Open escalation detail"
                  tabIndex={-1}
                >
                  →
                </Link>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ListSkeleton({ columns }: { columns: number }) {
  return (
    <div className="space-y-1.5 animate-pulse">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-4">
          {Array.from({ length: columns }, (_, j) => (
            <div key={j} className="h-3 bg-surface-sunken rounded flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}
