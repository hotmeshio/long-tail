import { forwardRef } from 'react';
import { Undo2, X } from 'lucide-react';
import type { ConfidenceTone } from '../../../../lib/x-lt-confidence';

export type PillTone = 'default' | 'error' | 'warning' | 'added' | 'edited' | 'removed';

const TONES: Record<PillTone, string> = {
  default: 'bg-surface-sunken text-text-secondary',
  error: 'bg-status-error/10 text-status-error',
  warning: 'bg-status-pending-graphic/15 text-status-warning',
  added: 'bg-status-active/10 text-status-active',
  edited: 'bg-accent-faint text-accent',
  removed: 'bg-surface-sunken text-text-quaternary line-through',
};

const CONFIDENCE_RING: Record<ConfidenceTone, string> = {
  error: 'ring-1 ring-status-error/60',
  warning: 'ring-1 ring-status-pending-graphic/70',
  info: 'ring-1 ring-status-active/60',
};

/**
 * One value in a pills control. The pill is a focus stop of its own (arrow keys
 * move between pills, Enter edits, Delete removes); the remove control is a
 * named button.
 */
export const Pill = forwardRef<HTMLSpanElement, {
  text: string;
  tone?: PillTone;
  title?: string;
  suffix?: string;
  locked?: boolean;
  /** The tranche tone of this item's confidence score. */
  confidence?: ConfidenceTone;
  onRemove?: () => void;
  onRestore?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLSpanElement>) => void;
  onFocus?: () => void;
  onDoubleClick?: () => void;
}>(function Pill({ text, tone = 'default', title, suffix, locked, confidence, onRemove, onRestore, onKeyDown, onFocus, onDoubleClick }, ref) {
  return (
    <span
      ref={ref}
      role="listitem"
      tabIndex={-1}
      title={title}
      data-pill
      data-tone={tone}
      data-confidence-pill={confidence}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onDoubleClick={onDoubleClick}
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-mono rounded outline-none focus-visible:ring-2 focus-visible:ring-accent ${TONES[tone]} ${confidence ? CONFIDENCE_RING[confidence] : ''}`}
    >
      {text}
      {suffix && <span className="text-2xs font-sans not-italic opacity-80">{suffix}</span>}
      {onRestore && (
        <button
          type="button"
          tabIndex={-1}
          onClick={onRestore}
          aria-label={`Restore ${text}`}
          className="-mr-1 p-0.5 rounded text-accent hover:bg-surface-hover"
        >
          <Undo2 className="w-3 h-3" strokeWidth={2} />
        </button>
      )}
      {onRemove && !locked && (
        <button
          type="button"
          tabIndex={-1}
          onClick={onRemove}
          aria-label={`Remove ${text}`}
          className="-mr-1 p-0.5 rounded text-text-quaternary hover:text-status-error hover:bg-surface-hover"
        >
          <X className="w-3 h-3" strokeWidth={2} />
        </button>
      )}
    </span>
  );
});
