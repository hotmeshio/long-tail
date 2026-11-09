import { useId, useState, type ReactNode } from 'react';
import { History, Undo2 } from 'lucide-react';
import type { FieldReview as FieldReviewState } from '../../../lib/x-lt-confidence';
import { REVIEW_TONE_CLASSES, formatScore } from './review-tones';

/**
 * A field the model proposed or scored. The control's border carries its
 * tranche's tone (globals.css, `data-confidence-tone`), and one quiet line
 * under it says which tranche and what score. Once the answer differs from
 * the proposal the line says so: while editing, a button opens the proposed
 * value with Restore; on a locked or resolved form the line shows what it
 * was, struck through, beside what it became.
 */
export function FieldReview({ fieldKey, review, proposedText, currentText, locked, onRestore, children }: {
  fieldKey: string;
  review: FieldReviewState;
  proposedText: string;
  currentText: string;
  locked: boolean;
  onRestore: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const tone = review.tranche ? REVIEW_TONE_CLASSES[review.tranche.tone] : null;

  return (
    <div
      data-confidence-tone={review.tranche?.tone}
      data-review-changed={review.changed || undefined}
      data-testid={`review-${fieldKey}`}
    >
      {children}
      {(review.tranche || review.changed) && (
        <div className="mt-1 flex items-center gap-3 flex-wrap text-2xs">
          {review.tranche && tone && (
            <span className={`inline-flex items-center gap-1.5 ${tone.text}`} data-testid={`review-tranche-${fieldKey}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} aria-hidden />
              {review.tranche.label}
              {review.score !== undefined && <span className="tabular-nums">· {formatScore(review.score)}</span>}
            </span>
          )}
          {review.changed && locked && (
            <span className="inline-flex items-center gap-1.5 text-text-tertiary min-w-0" data-testid={`review-was-${fieldKey}`}>
              <History className="w-3 h-3 shrink-0" strokeWidth={1.5} aria-hidden />
              <span>Was</span>
              <s className="text-text-secondary truncate" title={proposedText}>{proposedText}</s>
              <span aria-hidden>→</span>
              <span className="text-text-primary truncate" title={currentText}>{currentText}</span>
            </span>
          )}
          {review.changed && !locked && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls={panelId}
              className="inline-flex items-center gap-1 text-accent hover:text-accent-hover"
              data-testid={`review-edited-${fieldKey}`}
            >
              <History className="w-3 h-3" strokeWidth={1.5} aria-hidden />
              Edited
            </button>
          )}
        </div>
      )}
      {review.changed && !locked && open && (
        <div id={panelId} className="mt-1 flex items-center gap-2 text-2xs animate-[field-enter_0.2s_ease-out]">
          <span className="text-text-tertiary">Proposed</span>
          <span className="text-text-secondary truncate" title={proposedText}>{proposedText}</span>
          <button
            type="button"
            onClick={() => { onRestore(); setOpen(false); }}
            className="inline-flex items-center gap-1 text-accent hover:text-accent-hover shrink-0"
            data-testid={`review-restore-${fieldKey}`}
          >
            <Undo2 className="w-3 h-3" strokeWidth={1.5} aria-hidden />
            Restore
          </button>
        </div>
      )}
    </div>
  );
}
