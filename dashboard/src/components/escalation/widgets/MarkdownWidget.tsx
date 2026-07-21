import { useState } from 'react';
import { MarkdownRenderer } from '../../common/display/MarkdownRenderer';

interface MarkdownWidgetProps {
  fieldKey: string;
  value: string;
  onChange: (v: string) => void;
  schema?: Record<string, unknown>;
}

/**
 * Markdown field — the same renderer the docs drawer uses, so a versioned
 * form schema can carry page source. Two shapes:
 *
 * - `readOnly: true` → a content block. The field's markdown (typically the
 *   schema `default`) renders as HTML with no input chrome — instructions,
 *   SOPs, and context live in the form as authored, versioned pages.
 * - editable → a Write/Preview source editor. The submitted value is the
 *   markdown source.
 */
export function MarkdownWidget({ fieldKey, value, onChange, schema }: MarkdownWidgetProps) {
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const label = fieldKey.replace(/[_-]/g, ' ');
  const helperText = schema?.description as string | undefined;
  const isReadOnly = schema?.readOnly === true;

  if (isReadOnly) {
    // Pure content block — the markdown carries its own headings and structure.
    return <MarkdownRenderer content={value} className="my-1" />;
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary">
          {label}
        </label>
        <div className="flex items-center gap-0.5">
          {(['write', 'preview'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-2 py-0.5 text-2xs rounded transition-colors ${
                tab === t
                  ? 'bg-accent/10 text-accent font-semibold'
                  : 'text-text-quaternary hover:text-text-secondary'
              }`}
            >
              {t === 'write' ? 'Write' : 'Preview'}
            </button>
          ))}
        </div>
      </div>
      {helperText && <p className="text-2xs text-text-tertiary mt-0.5">{helperText}</p>}
      {tab === 'write' ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input w-full mt-1 text-sm font-mono leading-relaxed"
          rows={10}
          placeholder="Write markdown — headings, lists, tables, code blocks, and links all render."
        />
      ) : (
        <div className="mt-1 px-3 py-2 border border-surface-border rounded min-h-[120px]">
          {value.trim() ? (
            <MarkdownRenderer content={value} />
          ) : (
            <p className="text-xs text-text-quaternary italic">Nothing to preview.</p>
          )}
        </div>
      )}
    </div>
  );
}
