import { useState } from 'react';
import { Paperclip, Download, ExternalLink } from 'lucide-react';
import type { WidgetProps } from './index';

/**
 * Attachment widget — readOnly display of a binary value captured earlier
 * (typically by the file-upload widget): a data URL or a fetchable URL.
 * Declared as `x-lt-widget: "attachment"` (`"image"` is an accepted alias).
 *
 * Type dispatch keeps rendering safe:
 *   image/*    — inline constrained preview, click for full size (the <img>
 *                context is script-inert, so data URLs are safe here)
 *   everything else — a labeled open/download affordance, NEVER embedded as a
 *                document (inlining arbitrary data: content is an XSS vector)
 */

type Kind =
  | { kind: 'none' }
  | { kind: 'image'; src: string }
  | { kind: 'file'; href: string; label: string; isData: boolean };

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?.*)?$/i;

function classify(value: string): Kind {
  const v = value.trim();
  if (!v) return { kind: 'none' };

  const dataMime = /^data:([^;,]+)[;,]/.exec(v)?.[1]?.toLowerCase();
  if (dataMime) {
    if (dataMime.startsWith('image/')) return { kind: 'image', src: v };
    const label = dataMime === 'application/pdf' ? 'PDF' : dataMime;
    return { kind: 'file', href: v, label, isData: true };
  }

  if (/^https?:\/\//i.test(v)) {
    if (IMAGE_EXT.test(v)) return { kind: 'image', src: v };
    const ext = /\.([a-z0-9]{2,5})(\?.*)?$/i.exec(v)?.[1]?.toUpperCase();
    return { kind: 'file', href: v, label: ext ?? 'attachment', isData: false };
  }

  return { kind: 'none' };
}

export function AttachmentWidget({ fieldKey, value, schema }: WidgetProps) {
  const [expanded, setExpanded] = useState(false);
  const att = classify(value ?? '');
  const label = fieldKey.replace(/[_-]/g, ' ');
  const helperText = schema?.description as string | undefined;

  const head = (
    <>
      <label className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary">
        {label}
      </label>
      {helperText && <p className="text-2xs text-text-tertiary mt-0.5">{helperText}</p>}
    </>
  );

  if (att.kind === 'none') {
    return (
      <div>
        {head}
        <p className="text-xs text-text-quaternary italic mt-1">No attachment</p>
      </div>
    );
  }

  if (att.kind === 'image') {
    return (
      <div>
        {head}
        <div className="mt-1">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="block rounded-[0.125em] border border-surface-border overflow-hidden hover:border-accent transition-colors"
          title="View full size"
        >
          <img
            src={att.src}
            alt={fieldKey.replace(/[_-]/g, ' ')}
            className="max-h-48 max-w-full object-contain"
            data-testid={`attachment-image-${fieldKey}`}
          />
        </button>
        {expanded && (
          <div
            className="fixed inset-0 z-[100] bg-text-primary/60 backdrop-blur-sm flex items-center justify-center p-8 cursor-zoom-out"
            onClick={() => setExpanded(false)}
            role="dialog"
            aria-modal="true"
            aria-label={`${label} — full size`}
          >
            <img src={att.src} alt={label} className="max-h-[90vh] max-w-[90vw] object-contain" />
          </div>
        )}
        </div>
      </div>
    );
  }

  // Non-image: safe open/download only — the content is never embedded.
  return (
    <div>
      {head}
      <div className="mt-1">
        <a
          href={att.href}
          {...(att.isData
            ? { download: `${fieldKey}.${att.label === 'PDF' ? 'pdf' : 'bin'}` }
            : { target: '_blank', rel: 'noopener noreferrer' })}
          className="inline-flex items-center gap-1.5 text-xs text-accent hover:text-accent-hover transition-colors"
          data-testid={`attachment-link-${fieldKey}`}
        >
          <Paperclip className="w-3.5 h-3.5" strokeWidth={1.5} />
          {att.isData ? `Download ${att.label}` : `Open ${att.label}`}
          {att.isData
            ? <Download className="w-3 h-3" strokeWidth={1.5} />
            : <ExternalLink className="w-3 h-3" strokeWidth={1.5} />}
        </a>
      </div>
    </div>
  );
}
