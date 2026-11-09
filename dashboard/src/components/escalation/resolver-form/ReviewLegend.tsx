import { useRef } from 'react';
import { History } from 'lucide-react';
import type { ReviewSummary } from '../../../lib/x-lt-confidence';
import { REVIEW_TONE_CLASSES } from './review-tones';

/** Bring the next field of a group into view and focus its control. */
function visitNext(keys: string[], cursor: { current: number }) {
  if (keys.length === 0) return;
  const key = keys[cursor.current % keys.length];
  cursor.current += 1;
  const el = document.querySelector<HTMLElement>(`[data-field-key="${key.replace(/["\\]/g, '\\$&')}"]`);
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el?.focus({ preventScroll: true });
}

/**
 * The form's review key: one entry per tranche with its field count, and the
 * edited count. Each entry walks its fields, one press per field, so a
 * reviewer works the low-confidence set top to bottom without hunting.
 */
export function ReviewLegend({ summary, proposedCount }: { summary: ReviewSummary; proposedCount: number }) {
  const cursors = useRef<Record<string, { current: number }>>({});
  const cursorFor = (id: string) => (cursors.current[id] ??= { current: 0 });
  const tranches = summary.tranches.filter((t) => t.fields.length > 0);
  if (tranches.length === 0 && summary.changed.length === 0) return null;

  return (
    <div className="flex items-center gap-x-4 gap-y-1 flex-wrap mb-6 text-xs" role="group" aria-label="Review" data-testid="review-legend">
      {tranches.map(({ tranche, fields }) => {
        const tone = REVIEW_TONE_CLASSES[tranche.tone];
        return (
          <button
            key={tranche.below}
            type="button"
            onClick={() => visitNext(fields, cursorFor(`t${tranche.below}`))}
            className={`inline-flex items-center gap-1.5 ${tone.text} hover:underline`}
            title={`Go to the next field scored below ${Math.round(tranche.below * 100)}%`}
          >
            <span className={`w-2 h-2 rounded-full ${tone.dot}`} aria-hidden />
            {tranche.label}
            <span className="tabular-nums font-semibold">{fields.length}</span>
          </button>
        );
      })}
      {summary.changed.length > 0 && (
        <button
          type="button"
          onClick={() => visitNext(summary.changed, cursorFor('edited'))}
          className="inline-flex items-center gap-1.5 text-accent hover:underline"
        >
          <History className="w-3.5 h-3.5" strokeWidth={1.5} aria-hidden />
          Edited
          <span className="tabular-nums font-semibold">{summary.changed.length}</span>
          {proposedCount > 0 && <span className="text-text-tertiary font-normal">of {proposedCount}</span>}
        </button>
      )}
    </div>
  );
}
