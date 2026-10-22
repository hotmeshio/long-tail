import { useState } from 'react';
import { FieldLabel, FieldHelper } from '../resolver-form/FieldChrome';
import { RosterEntryRow, type OfferedAction } from './RosterEntryRow';
import { useEmbedWrite } from './embed-write';
import { useRosters } from '../../../hooks/useRosters';
import { ApiError } from '../../../api/client';
import { ROSTER_ACTION_OUTCOMES, useRosterAction } from '../../../api/escalations';
import { getDeep } from '../../../lib/x-lt-bind';
import type { EmbedColumnDef } from '../../../lib/embed-row';
import { offersAction, readRosterActions } from '../../../lib/x-lt-actions';
import { readRosterDef, rosterHeadline, type RosterEntry } from '../../../lib/x-lt-roster';
import type { EscalationItem } from '../../../lib/escalation-items';
import type { ShowIfContext } from '../../../lib/x-lt-show-if';
import type { WidgetProps } from './index';

const DEFAULT_COLUMNS: EmbedColumnDef[] = [{ label: 'Item', value: '{{item.itemKey}}' }];
const EMBED_WRITE_VERB = 'continue';
const BADGE_OUTCOMES: string[] = [ROSTER_ACTION_OUTCOMES.NEEDS_BADGE, ROSTER_ACTION_OUTCOMES.ROLE_REFUSED];

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** The value a per-key envelope map holds for the entry, when it is a string. */
function keyed(ctx: ShowIfContext, map: string, key: string): string | undefined {
  const values = getDeep(ctx.envelope, map);
  const value = isRecord(values) ? values[key] : undefined;
  return typeof value === 'string' ? value : undefined;
}

/**
 * The entry's `item` domain: its key, a batch label, and the item once it is
 * in. A held item reads its payload, time and actor from `accumulate_items`;
 * a batch entry reads its payload from `batch_items` and its time and actor
 * from `batch_filled_at` and `batch_filled_by`.
 */
function itemFor(entry: RosterEntry, ctx: ShowIfContext): EscalationItem & { label?: unknown } {
  const held = getDeep(ctx.envelope, 'accumulate_items');
  const batchPayload = getDeep(ctx.envelope, 'batch_items');
  const h = isRecord(held) && isRecord(held[entry.key]) ? held[entry.key] as Record<string, unknown> : null;
  const payload = h && isRecord(h.payload) ? h.payload
    : isRecord(batchPayload) && isRecord(batchPayload[entry.key]) ? batchPayload[entry.key] as Record<string, unknown>
    : undefined;
  const at = typeof h?.at === 'string' ? h.at : h ? undefined : keyed(ctx, 'batch_filled_at', entry.key);
  const actor = typeof h?.actor === 'string' ? h.actor : h ? undefined : keyed(ctx, 'batch_filled_by', entry.key);
  return {
    itemKey: entry.key,
    at: at ?? '',
    ...(payload ? { payload } : {}),
    ...(actor ? { actor } : {}),
    ...(entry.label !== undefined ? { label: entry.label } : {}),
  };
}

/**
 * Roster widget: every member the host row expects, each marked waiting, in,
 * or flagged, with the count in the heading. The entries come from the same
 * shared computation the page reads for `roster.*` and the roster guard,
 * against the live form, so a scan into a form field ticks its entry in at
 * once and an arrival on any device ticks it in on the next escalation
 * event.
 *
 * Actions run on the server (`/escalations/:id/roster-action`), which
 * re-reads the declaration: a resolve of the entry's member row, or a fill,
 * flag or unflag of its batch key. An action limited to roles asks for a
 * badge of that role when the person acting lacks it.
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
  const def = readRosterDef(schema);
  const batch = !!def && 'batch' in def.expected;
  const columns = (schema?.['x-lt-columns'] as EmbedColumnDef[] | undefined) ?? DEFAULT_COLUMNS;
  const actions = readRosterActions(schema);
  const label = (schema?.title as string | undefined) ?? 'Expected items';
  const helperText = schema?.description as string | undefined;
  const hostId = String((ctx.escalation as Record<string, unknown> | undefined)?.id ?? '');

  const runAction = useRosterAction();
  const guard = useEmbedWrite();
  const [asking, setAsking] = useState<{ key: string; offer: OfferedAction } | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const fire = async (entry: RosterEntry, offer: OfferedAction, code?: string): Promise<void> => {
    setPendingKey(entry.key);
    setErrors((prev) => ({ ...prev, [entry.key]: '' }));
    try {
      await runAction.mutateAsync({ id: hostId, field: fieldKey, action: offer.index, entry: entry.key, code });
    } catch (err) {
      const message = (err as Error).message;
      setErrors((prev) => ({ ...prev, [entry.key]: message }));
      const outcome = err instanceof ApiError && isRecord(err.body) ? err.body.outcome : undefined;
      if (typeof outcome === 'string' && BADGE_OUTCOMES.includes(outcome)) {
        guard(EMBED_WRITE_VERB, () => fire(entry, offer, code), { badge: message });
      }
    } finally {
      setPendingKey(null);
    }
  };

  const act = (entry: RosterEntry, offer: OfferedAction, code?: string) => {
    setAsking(null);
    guard(EMBED_WRITE_VERB, () => fire(entry, offer, code));
  };

  const request = (entry: RosterEntry, offer: OfferedAction) => {
    if (offer.action.confirm || offer.action.fill?.enterCode) setAsking({ key: entry.key, offer });
    else act(entry, offer);
  };

  const offeredFor = (entry: RosterEntry): OfferedAction[] =>
    actions
      .map((action, index) => ({ action, index }))
      .filter(({ action }) => offersAction(action, entry, batch));

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
              offered={hostId ? offeredFor(entry) : []}
              asking={asking?.key === entry.key ? asking.offer : null}
              pending={pendingKey === entry.key}
              error={errors[entry.key] || undefined}
              onAction={(offer) => request(entry, offer)}
              onConfirm={(code) => asking && act(entry, asking.offer, code)}
              onCancel={() => setAsking(null)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
