import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, X, User } from 'lucide-react';
import { useAccumulateItem, useRemoveAccumulatedItem } from '../../api/escalations';
import { DateValue } from '../common/display/DateValue';
import { UserName } from '../common/display/UserName';
import { summarizePayload, type EscalationItems } from '../../lib/escalation-items';

/**
 * The held items of an accumulator or batch row, in arrival order, with the
 * count against its max. On a pending accumulator the actor can add an item
 * (key plus optional JSON payload) or remove one; both go through the same
 * guarded statements the API exposes, so a stale panel gets the server's
 * answer rather than a local guess.
 */
export function EscalationItemsPanel({ escalationId, items, canWrite }: {
  escalationId: string;
  items: EscalationItems;
  canWrite: boolean;
}) {
  const add = useAccumulateItem();
  const remove = useRemoveAccumulatedItem();
  const [itemKey, setItemKey] = useState('');
  const [payloadText, setPayloadText] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const writable = canWrite && items.kind === 'accumulate';
  const isFull = items.max !== null && items.count >= items.max;

  const submit = () => {
    const key = itemKey.trim();
    if (!key) { setFormError('An item key is required.'); return; }
    let payload: Record<string, unknown> | undefined;
    if (payloadText.trim()) {
      try {
        const parsed = JSON.parse(payloadText);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object');
        payload = parsed;
      } catch {
        setFormError('Payload must be a JSON object.');
        return;
      }
    }
    setFormError(null);
    add.mutate({ id: escalationId, itemKey: key, payload }, {
      onSuccess: () => { setItemKey(''); setPayloadText(''); },
    });
  };

  const noun = items.kind === 'batch' ? 'filled' : 'held';
  const headline = items.max === null
    ? `${items.count} ${noun}`
    : `${items.count} of ${items.max} ${noun}`;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-text-primary" data-testid="items-headline">{headline}</span>
        <span className="text-2xs uppercase tracking-wide text-text-tertiary">
          {items.kind === 'batch' ? 'Batch' : items.max === null ? 'Open' : 'Accumulator'}
        </span>
      </div>

      {items.items.length === 0 ? (
        <p className="text-xs text-text-tertiary italic">Nothing held yet.</p>
      ) : (
        <ol className="divide-y divide-surface-border/60" data-testid="items-list">
          {items.items.map((item, index) => (
            <li key={item.itemKey} className="py-2 flex items-start gap-2 group">
              <span className="text-2xs text-text-quaternary font-mono w-5 shrink-0 text-right pt-0.5">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-mono text-text-primary truncate" title={item.itemKey}>{item.itemKey}</span>
                  {item.reciprocalId && (
                    <Link
                      to={`/escalations/detail/${item.reciprocalId}`}
                      className="icon-link text-2xs shrink-0"
                      title="Open the reciprocal escalation"
                    >
                      linked
                    </Link>
                  )}
                </div>
                {item.payload && (
                  <div className="text-2xs text-text-secondary truncate" title={JSON.stringify(item.payload)}>
                    {summarizePayload(item.payload)}
                  </div>
                )}
                <div className="flex items-center gap-2 text-2xs text-text-tertiary">
                  {item.at && <DateValue date={item.at} />}
                  {item.actor && (
                    <span className="inline-flex items-center gap-1">
                      <User className="w-2.5 h-2.5" />
                      <UserName userId={item.actor} />
                    </span>
                  )}
                </div>
              </div>
              {writable && (
                <button
                  type="button"
                  onClick={() => remove.mutate({ id: escalationId, itemKey: item.itemKey })}
                  disabled={remove.isPending}
                  className="icon-link opacity-50 group-hover:opacity-100 shrink-0 p-0.5"
                  title={`Remove ${item.itemKey}`}
                  aria-label={`Remove ${item.itemKey}`}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </li>
          ))}
        </ol>
      )}

      {items.kind === 'batch' && items.pending.length > 0 && (
        <p className="text-2xs text-text-tertiary">
          Awaiting: <span className="font-mono">{items.pending.join(', ')}</span>
        </p>
      )}

      {writable && (
        <form
          className="space-y-2 pt-2 border-t border-surface-border/60"
          onSubmit={(e) => { e.preventDefault(); submit(); }}
          data-testid="add-item-form"
        >
          <label className="block text-2xs uppercase tracking-wide text-text-secondary">Add item</label>
          <input
            value={itemKey}
            onChange={(e) => setItemKey(e.target.value)}
            placeholder="Item key"
            aria-label="Item key"
            disabled={isFull || add.isPending}
            className="w-full text-xs font-mono px-2 py-1.5 rounded-md bg-surface-base border border-surface-border text-text-primary placeholder:text-text-quaternary focus:outline-none focus:border-accent disabled:opacity-50"
          />
          <textarea
            value={payloadText}
            onChange={(e) => setPayloadText(e.target.value)}
            placeholder='Payload JSON (optional), e.g. {"weight": 2}'
            aria-label="Item payload"
            rows={2}
            disabled={isFull || add.isPending}
            className="w-full text-xs font-mono px-2 py-1.5 rounded-md bg-surface-base border border-surface-border text-text-primary placeholder:text-text-quaternary focus:outline-none focus:border-accent disabled:opacity-50"
          />
          <div className="flex items-center justify-end gap-3">
            {isFull && <span className="text-2xs text-text-tertiary">Every slot is held.</span>}
            <button type="submit" disabled={isFull || add.isPending} className="btn-secondary text-xs inline-flex items-center gap-1">
              <Plus className="w-3 h-3" />
              {add.isPending ? 'Adding…' : 'Add'}
            </button>
          </div>
          {(formError || add.error || remove.error) && (
            <p className="text-2xs text-status-error" role="alert">
              {formError ?? (add.error as Error | null)?.message ?? (remove.error as Error | null)?.message}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
