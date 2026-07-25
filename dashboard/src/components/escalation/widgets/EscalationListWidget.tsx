import { useState } from 'react';
import { Link } from 'react-router-dom';
import { interpolateHelp } from '../../../lib/x-lt-help';
import { formatAgoCompact } from '../../../lib/format';
import { rowContext } from '../EscalationListView';
import { useEscalations, useResolveEscalation } from '../../../api/escalations';
import { useAuth } from '../../../hooks/useAuth';
import { FieldLabel, FieldHelper } from '../resolver-form/FieldChrome';
import { resolveScopedQuery, type EmbedQuery } from '../../../lib/x-lt-query';
import type { WidgetProps } from './index';
import type { ShowIfContext } from '../../../lib/x-lt-show-if';
import type { LTEscalationRecord } from '../../../api/types';

interface ColumnDef { label: string; value: string; format?: string }

/**
 * An inline row action: fires a canned resolve against the row through the
 * standard resolve endpoint — RBAC and enforce_schema validation apply
 * server-side exactly as a full-form resolve. String leaves inside
 * `resolverPayload` (and `confirm`) interpolate `{{domain.path}}` tokens
 * against the row's own context; booleans and numbers pass through typed.
 */
interface ActionDef {
  label: string;
  resolverPayload: Record<string, unknown>;
  /** Optional confirm prompt shown before firing; tokens interpolate per row. */
  confirm?: string;
}

const DEFAULT_COLUMNS: ColumnDef[] = [
  { label: 'Description', value: '{{escalation.description}}' },
  { label: 'Role', value: '{{escalation.role}}' },
  { label: 'Age', value: '{{escalation.created_at}}', format: 'age' },
];

const EM_DASH = '—';

function renderValue(raw: string, format?: string): string {
  if (!raw || raw === EM_DASH) return EM_DASH;
  if (format === 'age') {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? raw : formatAgoCompact(raw);
  }
  return raw;
}

/** Deep-walk a payload template: string leaves interpolate `{{domain.path}}`
 *  tokens against the row context; every other type passes through typed. */
function interpolatePayload(value: unknown, ctx: ShowIfContext): unknown {
  if (typeof value === 'string') return interpolateHelp(value, ctx);
  if (Array.isArray(value)) return value.map((v) => interpolatePayload(v, ctx));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, interpolatePayload(v, ctx)]),
    );
  }
  return value;
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
 *   "x-lt-actions": [                              (optional)
 *     { "label": "Bagged ✓",
 *       "resolverPayload": { "approved": true, "checks": { "bagged": true } },
 *       "confirm": "Bag {{metadata.orderId}}?" }
 *   ]
 *
 * Column `value` strings use the same `{{domain.path}}` token convention as
 * `x-lt-active.fields` and `x-lt-columns` in list schemas — tokens resolve
 * against each displayed escalation's own row context.
 *
 * When `x-lt-columns` is absent, falls back to three default columns:
 * description, role, age.
 *
 * Produces no resolver payload for the PARENT form and must not appear in
 * `required`. `x-lt-actions` buttons resolve the ROW through the standard
 * resolve endpoint — server-side RBAC and enforce_schema apply; a rejected
 * canned resolve surfaces its message inline and the row's detail link
 * remains the full-form path.
 */
export function EscalationListWidget({ fieldKey, schema, escalationContext }: WidgetProps) {
  const rawQuery = (schema?.['x-lt-query'] as EmbedQuery | undefined) ?? {};
  const columns = (schema?.['x-lt-columns'] as ColumnDef[] | undefined) ?? DEFAULT_COLUMNS;
  const actions = (schema?.['x-lt-actions'] as ActionDef[] | undefined) ?? [];
  const label = (schema?.title as string | undefined) ?? 'Related items';
  const helperText = schema?.description as string | undefined;

  const ctx = escalationContext ?? {};
  const { user } = useAuth();

  // ONE shared mapping (resolveScopedQuery) turns x-lt-query into concrete
  // escalation params — the same call x-lt-submit-guard makes, so the visible
  // rows and the guard's count evaluate the identical scope.
  const scoped = resolveScopedQuery(rawQuery, ctx, user?.userId);

  const { data, isLoading } = useEscalations({
    role: scoped.role,
    status: scoped.status,
    facets: scoped.facets,
    assigned_to: scoped.assigned_to,
    available: scoped.available,
    limit: scoped.limit ?? 5,
    enabled: scoped.enabled,
  });

  const escalations = data?.escalations ?? [];

  const resolve = useResolveEscalation();
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [pendingRow, setPendingRow] = useState<string | null>(null);

  const fireAction = async (esc: LTEscalationRecord, action: ActionDef) => {
    const rowCtx = rowContext(esc);
    if (action.confirm && !window.confirm(interpolateHelp(action.confirm, rowCtx))) return;
    setPendingRow(esc.id);
    setRowErrors((prev) => ({ ...prev, [esc.id]: '' }));
    try {
      await resolve.mutateAsync({
        id: esc.id,
        resolverPayload: interpolatePayload(action.resolverPayload, rowCtx) as Record<string, unknown>,
      });
    } catch (err) {
      setRowErrors((prev) => ({ ...prev, [esc.id]: (err as Error).message }));
    } finally {
      setPendingRow(null);
    }
  };

  return (
    <div data-field-key={fieldKey}>
      <FieldLabel>{label}</FieldLabel>
      {helperText && <FieldHelper>{helperText}</FieldHelper>}
      <div className="mt-1" data-testid={`escalation-list-widget-${fieldKey}`}>
        {isLoading ? (
          <ListSkeleton columns={columns.length} />
        ) : (
          <EmbedTable
            escalations={escalations}
            columns={columns}
            fieldKey={fieldKey}
            actions={actions}
            onAction={fireAction}
            pendingRow={pendingRow}
            rowErrors={rowErrors}
          />
        )}
      </div>
    </div>
  );
}

function EmbedTable({
  escalations,
  columns,
  fieldKey,
  actions,
  onAction,
  pendingRow,
  rowErrors,
}: {
  escalations: LTEscalationRecord[];
  columns: ColumnDef[];
  fieldKey: string;
  actions: ActionDef[];
  onAction: (esc: LTEscalationRecord, action: ActionDef) => void;
  pendingRow: string | null;
  rowErrors: Record<string, string>;
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
          {actions.length > 0 && <th className="w-px" />}
          <th className="w-4" />
        </tr>
      </thead>
      <tbody>
        {escalations.map((esc) => {
          const ctx = rowContext(esc);
          const error = rowErrors[esc.id];
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
              {actions.length > 0 && (
                <td className="py-1 pr-2 align-top whitespace-nowrap">
                  {actions.map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      onClick={() => onAction(esc, action)}
                      disabled={pendingRow === esc.id}
                      className="px-2 py-0.5 text-2xs font-medium text-accent border border-accent/40 rounded hover:bg-accent/10 disabled:opacity-40 disabled:cursor-default transition-colors ml-1 first:ml-0"
                      data-testid={`escalation-list-action-${esc.id}`}
                    >
                      {action.label}
                    </button>
                  ))}
                  {error && (
                    <p className="text-2xs text-status-error mt-0.5 whitespace-normal max-w-[16rem]" data-testid={`escalation-list-action-error-${esc.id}`}>
                      {error}
                    </p>
                  )}
                </td>
              )}
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
