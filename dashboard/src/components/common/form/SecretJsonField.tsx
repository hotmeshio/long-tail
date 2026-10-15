import { useState } from 'react';
import { Check, Copy, Eye, EyeOff } from 'lucide-react';

const MASK = '••••••••';

/** True when the JSON text holds at least one value worth masking. */
export function hasSecretValues(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  try {
    const parsed = JSON.parse(trimmed);
    return !!parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0;
  } catch {
    return true;
  }
}

/** The JSON text with every value replaced by a mask; keys stay readable. */
export function maskJsonValues(text: string): string {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return MASK;
    const masked = Object.fromEntries(Object.keys(parsed).map((k) => [k, MASK]));
    return JSON.stringify(masked, null, 2);
  } catch {
    return MASK;
  }
}

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  rows?: number;
}

/**
 * A JSON object of secrets (headers, env vars). Saved values are masked until
 * the user shows them; an empty field starts editable.
 */
export function SecretJsonField({ label, value, onChange, placeholder, hint, rows = 3 }: Props) {
  const [revealed, setRevealed] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);
  const shown = revealed ?? !hasSecretValues(value);

  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="label">{label}</label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setRevealed(!shown)}
            className="flex items-center gap-1 text-2xs text-text-tertiary hover:text-text-primary"
            aria-pressed={shown}
          >
            {shown ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {shown ? 'Hide' : 'Show'}
          </button>
          <button
            type="button"
            onClick={copy}
            disabled={!value.trim()}
            className="flex items-center gap-1 text-2xs text-text-tertiary hover:text-text-primary disabled:opacity-40"
            title="Copy to clipboard"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-status-success" /> : <Copy className="w-3.5 h-3.5" />}
            Copy
          </button>
        </div>
      </div>
      <textarea
        aria-label={label}
        value={shown ? value : maskJsonValues(value)}
        onChange={(e) => {
          setRevealed(true);
          onChange(e.target.value);
        }}
        readOnly={!shown}
        placeholder={placeholder}
        className="input-json w-full"
        rows={rows}
        spellCheck={false}
        autoComplete="off"
      />
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}
