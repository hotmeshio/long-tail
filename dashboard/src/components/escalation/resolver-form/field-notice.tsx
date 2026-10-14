import { createContext, useContext } from 'react';

/** The latest scan into a form field: refused (error) or written. */
export interface FieldNotice {
  field: string;
  error: string | null;
  at: number;
  /** The accept line, e.g. "Scanned into Bags in the box". */
  message?: string;
}

const FieldNoticeContext = createContext<FieldNotice | null>(null);

export const FieldNoticeProvider = FieldNoticeContext.Provider;

/** The notice for one field, or null. */
export function useFieldNotice(fieldKey: string): FieldNotice | null {
  const notice = useContext(FieldNoticeContext);
  return notice && notice.field === fieldKey ? notice : null;
}

/** A refused scan reads as the field's error; an accepted one as a quiet line under it. */
export function FieldNoticeLine({ notice }: { notice: FieldNotice | null }) {
  if (!notice) return null;
  return notice.error ? (
    <p key={notice.at} role="alert" className="text-2xs text-status-error mt-1 animate-[field-error-in_0.3s_ease-out]" data-testid="field-scan-notice">
      {notice.error}
    </p>
  ) : (
    <p key={notice.at} role="status" className="text-2xs text-status-success mt-1" data-testid="field-scan-notice">
      {notice.message ?? 'Scanned'}
    </p>
  );
}
