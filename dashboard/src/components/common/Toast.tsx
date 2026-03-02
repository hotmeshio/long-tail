interface ToastProps {
  message: string;
  type: 'success' | 'error' | 'info';
  onDismiss: () => void;
}

const borderColor = {
  success: 'border-l-status-success',
  error: 'border-l-status-error',
  info: 'border-l-accent',
} as const;

export function Toast({ message, type, onDismiss }: ToastProps) {
  return (
    <div
      role="status"
      className={`flex items-start gap-3 bg-surface-raised shadow-lg rounded-md border border-surface-border border-l-4 ${borderColor[type]} px-4 py-3 min-w-[280px] max-w-md animate-[slideIn_150ms_ease-out]`}
    >
      <p className="text-sm text-text-primary flex-1">{message}</p>
      <button
        onClick={onDismiss}
        className="text-text-tertiary hover:text-text-primary text-lg leading-none shrink-0"
        aria-label="Dismiss"
      >
        &times;
      </button>
    </div>
  );
}
