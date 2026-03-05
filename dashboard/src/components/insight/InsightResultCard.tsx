import { Link } from 'react-router-dom';
import type { InsightResult } from '../../api/insight';

interface InsightResultCardProps {
  result: InsightResult;
}

const LINK_RE = /\[([^\]]+)\]\(((?:\/|https?:\/\/)[^)]+)\)/g;

/**
 * Render text with inline markdown links.
 * - Relative URLs (starting with /) → React Router <Link>
 * - External URLs (https://) → <a> with target="_blank"
 */
function LinkedText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  LINK_RE.lastIndex = 0;
  while ((match = LINK_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const url = match[2];
    if (url.startsWith('http')) {
      parts.push(
        <a
          key={key++}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          {match[1]}
        </a>,
      );
    } else {
      parts.push(
        <Link
          key={key++}
          to={url}
          className="text-accent hover:underline"
        >
          {match[1]}
        </Link>,
      );
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <>{parts}</>;
}

export function InsightResultCard({ result }: InsightResultCardProps) {
  return (
    <div className="mt-10">
      {/* Title */}
      <h3 className="text-xl font-medium text-text-primary">
        {result.title}
      </h3>

      {/* Summary */}
      <p className="text-sm text-text-secondary leading-relaxed mt-3 mb-10">
        <LinkedText text={result.summary} />
      </p>

      {/* Metrics */}
      {result.metrics?.length > 0 && (
        <div className="flex flex-wrap gap-x-12 gap-y-6 mb-12">
          {result.metrics.map((m, i) => (
            <div key={i}>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1.5">
                {m.label}
              </p>
              <p className="text-2xl font-light text-text-primary">{m.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Sections */}
      {result.sections?.length > 0 && (
        <div className="space-y-8">
          {result.sections.map((s, i) => (
            <div key={i}>
              <h4 className="text-xs font-semibold uppercase tracking-widest text-text-tertiary mb-2">
                {s.heading}
              </h4>
              <p className="text-sm text-text-secondary leading-loose whitespace-pre-wrap">
                <LinkedText text={s.content} />
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Meta */}
      <div className="flex items-center gap-4 mt-10 text-[10px] text-text-tertiary">
        <span>
          {result.tool_calls_made} tool call{result.tool_calls_made !== 1 ? 's' : ''}
        </span>
        <span>{(result.duration_ms / 1000).toFixed(1)}s</span>
      </div>
    </div>
  );
}
