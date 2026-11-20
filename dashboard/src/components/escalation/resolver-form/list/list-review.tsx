import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { ConfidenceTone, ConfidenceTranche, FieldReview } from '../../../../lib/x-lt-confidence';
import type { ListDiff, RemovedItem } from '../../../../lib/x-lt-list';
import type { JsonValue } from '../form-cells';
import { asItems } from './list-ops';

/**
 * What a list control needs to show about the model's proposal: which items
 * were added, removed or edited, how each item was scored, and the acts that
 * put a proposed item back. Absent when the form proposes and scores nothing.
 */
export interface ListReviewState {
  diff?: ListDiff;
  itemTranches?: Array<ConfidenceTranche | null>;
  cellTranches?: Array<Record<string, ConfidenceTranche | null> | null>;
  restoreRemoved?: (removed: RemovedItem) => void;
  restoreItem?: (index: number) => void;
}

const ListReviewContext = createContext<ListReviewState | null>(null);

export function useListReview(): ListReviewState | null {
  return useContext(ListReviewContext);
}

/** The review state of a list field, with the acts that restore proposed items into its value. */
export function ListReviewProvider({ review, value, onChange, children }: {
  review: FieldReview | undefined;
  value: JsonValue;
  onChange: (next: JsonValue) => void;
  children: ReactNode;
}) {
  const state = useMemo<ListReviewState | null>(() => {
    if (!review || (!review.diff && !review.itemTranches && !review.cellTranches)) return null;
    const items = asItems(value);
    return {
      diff: review.diff,
      itemTranches: review.itemTranches,
      cellTranches: review.cellTranches,
      restoreRemoved: (removed) => onChange([...items.slice(0, removed.before), removed.item as JsonValue, ...items.slice(removed.before)]),
      restoreItem: (index) => {
        const mark = review.diff?.marks[index];
        if (mark?.proposed !== undefined) onChange(items.map((v, i) => (i === index ? (mark.proposed as JsonValue) : v)));
      },
    };
  }, [review, value, onChange]);
  return <ListReviewContext.Provider value={state}>{children}</ListReviewContext.Provider>;
}

export const confidenceToneOf = (t: ConfidenceTranche | null | undefined): ConfidenceTone | undefined => t?.tone;
