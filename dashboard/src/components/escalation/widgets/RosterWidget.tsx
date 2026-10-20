import { useState } from 'react';
import { FieldLabel, FieldHelper } from '../resolver-form/FieldChrome';
import { RosterEntryRow, type RosterActionDef } from './RosterEntryRow';
import { useRosters } from '../../../hooks/useRosters';
import { useResolveEscalation } from '../../../api/escalations';
import { getDeep } from '../../../lib/x-lt-bind';
import { interpolatePayload, type EmbedColumnDef } from '../../../lib/embed-row';
import { rosterHeadline, type RosterEntry } from '../../../lib/x-lt-roster';
import type { EscalationItem } from '../../../lib/escalation-items';
import type { ShowIfContext } from '../../../lib/x-lt-show-if';
import type { WidgetProps } from './index';

const DEFAULT_COLUMNS: EmbedColumnDef[] = [{ label: 'Item', value: '{{item.itemKey}}' }];

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** The entry's `item` domain: its key, a batch label, and the held item once it is in. */
function itemFor(entry: RosterEntry, ctx: ShowIfContext): EscalationItem & { label?: unknown } {
  const held = getDeep(ctx.envelope, 'accumulate_items');
  const batchPayload = getDeep(ctx.envelope, 'batch_items');
  const h = isRecord(held) && isRecord(held[entry.key]) ? held[entry.key] as Record<string, unknown> : null;
  const payload = h && isRecord(h.payload) ? h.payload
    : isRecord(batchPayload) && isRecord(batchPayload[entry.key]) ? batchPayload[entry.key] as Record<string, unknown>
    : undefined;
  return {
    itemKey: entry.key,
    at: typeof h?.at === 'string' ? h.at : '',
    ...(payload ? { payload } : {}),
    ...(typeof h?.actor === 'string' ? { actor: h.actor } : {}),
    ...(entry.label !== undefined ? { label: entry.label } : {}),
  };
}

/**
 * Roster widget: every member the host row expects, each marked waiting, in,
 * or flagged, with the count in the heading. The entries come from the same
 * shared computation the page reads for `roster.*` and the roster guard,
 * against the live form, so a scan into a form field ticks its entry in at
 * once and an arrival on any device ticks it in on the next escalation
 * event. Actions resolve the entry's member row in place.
 *
 * Schema usage:
 *   "x-lt-widget": "roster",
 *   "x-lt-roster": { "expected": { ... }, "key": "...", "in": [...], "flagged": [...] },
 *   "x-lt-columns": [{ "label": "Order", "value": "{{metadata.orderId}}" }],
 *   "x-lt-actions": [{ "label": "Missing", "when": "waiting",
 *                      "resolverPayload": { "outcome": "missing" },
 *                      "confirm": "Mark {{metadata.orderId}} missing?" }]
 *
 * Display-only: produces no value of its own in the resolver payload.
 */
export function RosterWidget({ fieldKey, schema, escalationContext }: WidgetProps) {
  const ctx = escalationContext ?? {};
  const view = useRosters({ properties: { [fieldKey]: schema ?? {} } }, ctx)[fieldKey];
  const columns = (schema?.['x-lt-columns'] as EmbedColumnDef[] | undefined) ?? DEFAULT_COLUMNS;
  const actions = (schema?.['x-lt-actions'] as RosterActionDef[] | undefined) ?? [];
  const label = (schema?.title as string | undefined) ?? 'Expected items';
  const helperText = schema?.description as string | undefined;

  const resolve = useResolveEscalation();
  const [confirming, setConfirming] = useState<{ key: string; action: RosterActionDef } | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const fire = async (entry: RosterEntry, action: RosterActionDef) => {
    if (!entry.row) return;
    setConfirming(null);
    setPendingKey(entry.key);
    setErrors((prev) => ({ ...prev, [entry.key]: '' }));
    try {
      await resolve.mutateAsync({
        id: String(entry.row.escalation.id),
        resolverPayload: interpolatePayload(action.resolverPayload, entry.row) as Record<string, unknown>,
      });
    } catch (err) {
      setErrors((prev) => ({ ...prev, [entry.key]: (err as Error).message }));
    } finally {
      setPendingKey(null);
    }
  };

  const request = (entry: RosterEntry, action: RosterActionDef) => {
    if (action.confirm) setConfirming({ key: entry.key, action });
    else void fire(entry, action);
  };

  return (
    <div data-field-key={fieldKey} data-testid={`roster-widget-${fieldKey}`}>
      <div className="flex items-baseline justify-between gap-3">
        <FieldLabel>{label}</FieldLabel>
        {view && (
          <span className="text-sm font-medium text-text-primary" data-testid={`roster-headline-${fieldKey}`}>
            {rosterHeadline(view)}
          </span>
        )}
      </div>
      {helperText && <FieldHelper>{helperText}</FieldHelper>}
      {!view ? (
        <p className="text-xs text-text-tertiary py-2" data-testid={`roster-loading-${fieldKey}`}>Loading expected items…</p>
      ) : view.entries.length === 0 ? (
        <p className="text-xs text-text-tertiary italic py-2" data-testid={`roster-empty-${fieldKey}`}>Nothing expected.</p>
      ) : (
        <ul className="mt-1" data-testid={`roster-list-${fieldKey}`}>
          {view.entries.map((entry) => (
            <RosterEntryRow
              key={entry.key}
              entry={entry}
              item={itemFor(entry, ctx)}
              hostCtx={ctx}
              columns={columns}
              actions={actions}
              confirming={confirming?.key === entry.key ? confirming.action : null}
              pending={pendingKey === entry.key}
              error={errors[entry.key] || undefined}
              onAction={(action) => request(entry, action)}
              onConfirm={() => confirming && void fire(entry, confirming.action)}
              onCancel={() => setConfirming(null)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
