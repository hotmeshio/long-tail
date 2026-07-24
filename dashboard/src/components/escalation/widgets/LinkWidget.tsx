import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { interpolateHelp } from '../../../lib/x-lt-help';
import { FieldLabel, FieldHelper } from '../resolver-form/FieldChrome';
import type { WidgetProps } from './index';

/**
 * Link widget — a named navigation link whose URL is a `{{domain.path}}`
 * template resolved at render time from the escalation context.
 *
 * Schema usage:
 *   "x-lt-widget": "link"
 *   "x-lt-href": "/escalations/available?role=foo&facets={\"orderId\":\"{{metadata.orderId}}\"}"
 *   "title": "Human-readable label"
 *   "description": "One-line instruction text"
 *
 * URL behaviour:
 *   Paths starting with "/" navigate inside the dashboard (React Router <Link>).
 *   Anything else opens in a new tab with rel="noreferrer".
 *
 * This widget is display-only — it produces no resolver payload value and must
 * never appear in the schema's `required` array.
 */
export function LinkWidget({ fieldKey, schema, escalationContext }: WidgetProps) {
  const hrefTemplate = (schema?.['x-lt-href'] as string | undefined) ?? '';
  const href = hrefTemplate && escalationContext
    ? interpolateHelp(hrefTemplate, escalationContext)
    : hrefTemplate;

  const label = (schema?.title as string | undefined) ?? (schema?.description as string | undefined) ?? 'Open';
  const helperText = schema?.description as string | undefined;
  const isInternal = href.startsWith('/');
  const isEmpty = !href.trim();

  return (
    <div data-field-key={fieldKey}>
      <FieldLabel>{label}</FieldLabel>
      {helperText && <FieldHelper>{helperText}</FieldHelper>}
      <div className="mt-1">
        {isEmpty ? (
          <span className="text-xs text-text-quaternary italic">No link configured</span>
        ) : isInternal ? (
          <Link
            to={href}
            className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent-hover transition-colors"
            data-testid={`link-widget-${fieldKey}`}
          >
            {label}
            <ExternalLink className="w-3 h-3 shrink-0" strokeWidth={1.5} />
          </Link>
        ) : (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent-hover transition-colors"
            data-testid={`link-widget-${fieldKey}`}
          >
            {label}
            <ExternalLink className="w-3 h-3 shrink-0" strokeWidth={1.5} />
          </a>
        )}
      </div>
    </div>
  );
}
