/**
 * A confirmation asked in place, beside the control that asked it. Used by
 * embedded row actions instead of a browser dialog, which blocks a shared
 * station and every other tab.
 */
export function InlineConfirm({ message, onConfirm, onCancel, testId }: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  testId?: string;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2" role="group" aria-label="Confirm action" data-testid={testId}>
      <span className="text-xs text-text-primary whitespace-normal">{message}</span>
      <button
        type="button"
        onClick={onConfirm}
        className="px-2 py-0.5 text-2xs font-medium text-text-inverse bg-accent rounded hover:bg-accent/90 transition-colors"
        data-testid={testId ? `${testId}-yes` : undefined}
        autoFocus
      >
        Confirm
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="px-2 py-0.5 text-2xs font-medium text-text-secondary border border-surface-border rounded hover:bg-surface-hover transition-colors"
        data-testid={testId ? `${testId}-no` : undefined}
      >
        Cancel
      </button>
    </span>
  );
}
