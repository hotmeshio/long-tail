import { useState } from 'react';

/**
 * A code typed in place, beside the control that asked for it: a key-in for
 * an item whose barcode will not scan. The server checks the code against
 * the entry; Enter confirms.
 */
export function InlineCodeEntry({ label, onConfirm, onCancel, testId }: {
  label: string;
  onConfirm: (code: string) => void;
  onCancel: () => void;
  testId?: string;
}) {
  const [code, setCode] = useState('');
  const submit = () => { if (code.trim()) onConfirm(code.trim()); };
  return (
    <span className="inline-flex flex-wrap items-center gap-2" role="group" aria-label={label} data-testid={testId}>
      <input
        type="text"
        inputMode="numeric"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') onCancel();
        }}
        placeholder="Code on the label"
        aria-label="Code on the label"
        className="input text-xs py-0.5 w-40 font-mono"
        data-testid={testId ? `${testId}-input` : undefined}
        autoFocus
      />
      <button
        type="button"
        onClick={submit}
        disabled={!code.trim()}
        className="px-2 py-0.5 text-2xs font-medium text-text-inverse bg-accent rounded hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        data-testid={testId ? `${testId}-yes` : undefined}
      >
        {label}
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
