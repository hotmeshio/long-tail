import { OpenDetailButton } from './OpenDetailButton';

import { interpolateHelp } from '../../../lib/x-lt-help';
import { getDeep } from '../../../lib/x-lt-bind';
import { formatAgoCompact } from '../../../lib/format';
import { useEscalation } from '../../../api/escalations';
import { rowContext } from '../EscalationListView';
import { FieldLabel, FieldHelper } from '../resolver-form/FieldChrome';
import { StatusBadge } from '../../common/display/StatusBadge';
import type { WidgetProps } from './index';
import type { ShowIfContext } from '../../../lib/x-lt-show-if';

interface FieldDef { label: string; value: string; format?: string }

const EM_DASH = '—';

function resolveSourceId(
  sourcePath: string | undefined,
  escalationContext: ShowIfContext | undefined,
): string {
  if (!sourcePath || !escalationContext) return '';
  const dot = sourcePath.indexOf('.');
  if (dot === -1) return '';
  const domain = sourcePath.slice(0, dot) as keyof ShowIfContext;
  const path = sourcePath.slice(dot + 1);
  try {
    const v = getDeep(escalationContext[domain] as unknown, path);
    return typeof v === 'string' ? v : '';
  } catch {
    return '';
  }
}

function renderFieldValue(raw: string, format?: string): string {
  if (!raw || raw === EM_DASH) return EM_DASH;
  if (format === 'age') {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? raw : formatAgoCompact(raw);
  }
  return raw;
}

/**
 * Escalation widget — embeds a single escalation record inline in the form as
 * a compact card. The escalation ID is resolved from a `domain.path` declared
 * in `x-lt-source`; the card's detail rows are configured via `x-lt-fields`.
 *
 * Schema usage:
 *   "x-lt-widget": "escalation"
 *   "x-lt-source": "metadata.parent_escalation_id"   (any domain.path → ID)
 *   "x-lt-fields": [                                  (optional, any of escalation's data)
 *     { "label": "Order", "value": "{{metadata.orderId}}" },
 *     { "label": "Decision", "value": "{{resolver.decision}}" },
 *     { "label": "Age", "value": "{{escalation.created_at}}", "format": "age" }
 *   ]
 *   "title": "Card heading label"
 *   "description": "One-line instruction text"
 *
 * `x-lt-fields` token values resolve against the *embedded* escalation's own
 * context (its escalation row, metadata, envelope, payload, resolver) — not the
 * parent form's context. Same domain/path convention as x-lt-active.fields.
 *
 * Display-only — produces no resolver payload and must not appear in `required`.
 */
export function EscalationWidget({ fieldKey, schema, escalationContext }: WidgetProps) {
  const sourcePath = schema?.['x-lt-source'] as string | undefined;
  const fields = (schema?.['x-lt-fields'] as FieldDef[] | undefined) ?? [];
  const label = (schema?.title as string | undefined) ?? 'Linked escalation';
  const helperText = schema?.description as string | undefined;

  const id = resolveSourceId(sourcePath, escalationContext);
  const { data: esc, isLoading, isError } = useEscalation(id);

  return (
    <div data-field-key={fieldKey}>
      <FieldLabel>{label}</FieldLabel>
      {helperText && <FieldHelper>{helperText}</FieldHelper>}
      <div className="mt-1">
        {!id || isError ? (
          <p className="text-xs text-text-quaternary italic" data-testid={`escalation-widget-empty-${fieldKey}`}>
            No linked record
          </p>
        ) : isLoading ? (
          <EscalationCardSkeleton />
        ) : esc ? (
          <EscalationCard esc={esc} fields={fields} fieldKey={fieldKey} />
        ) : (
          <p className="text-xs text-text-quaternary italic">No linked record</p>
        )}
      </div>
    </div>
  );
}

function EscalationCard({
  esc,
  fields,
  fieldKey,
}: {
  esc: ReturnType<typeof useEscalation>['data'];
  fields: FieldDef[];
  fieldKey: string;
}) {
  if (!esc) return null;
  const ctx = rowContext(esc);

  return (
    <div
      className="border-l-2 border-accent-faint pl-3 py-2 space-y-2"
      data-testid={`escalation-widget-card-${fieldKey}`}
    >
      {/* Header: type + status */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-2xs font-semibold uppercase tracking-wider text-text-secondary">
          {esc.type}{esc.subtype && esc.subtype !== esc.type ? ` · ${esc.subtype}` : ''}
        </span>
        <StatusBadge status={esc.status} />
      </div>

      {/* Description */}
      {esc.description && (
        <p className="text-xs text-text-primary leading-snug">{esc.description}</p>
      )}

      {/* x-lt-fields facts — same dictionary visual as DictionaryList */}
      {fields.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
          {fields.map((f) => {
            const raw = interpolateHelp(f.value, ctx);
            const display = renderFieldValue(raw, f.format);
            return (
              <div key={f.label} className="contents">
                <dt className="text-2xs text-text-tertiary whitespace-nowrap">{f.label}</dt>
                <dd className="text-2xs text-text-primary">{display}</dd>
              </div>
            );
          })}
        </dl>
      )}

      {/* Footer: role, age, detail link */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs text-text-quaternary">
          {esc.role} · {formatAgoCompact(esc.created_at)}
        </span>
        <OpenDetailButton to={`/escalations/detail/${esc.id}`} />
      </div>
    </div>
  );
}

function EscalationCardSkeleton() {
  return (
    <div className="border-l-2 border-accent-faint pl-3 py-2 space-y-2 animate-pulse">
      <div className="h-3 w-32 bg-surface-sunken rounded" />
      <div className="h-3 w-48 bg-surface-sunken rounded" />
      <div className="h-3 w-24 bg-surface-sunken rounded" />
    </div>
  );
}
