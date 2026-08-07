/**
 * Truncate a long identifier in the MIDDLE, keeping its trailing characters
 * visible. For keyed values (serial numbers, order ids) the tail digits are
 * usually what disambiguates one from the next, so a head-truncating ellipsis
 * would hide the useful part. The full value is the hover title.
 *
 * Renders as a flex span: the head truncates, the tail is pinned. Give it a
 * bounded width (the parent cell) for the ellipsis to engage.
 */
export function CenterEllipsis({
  text,
  tail = 6,
  className = '',
}: {
  text: string;
  /** How many trailing characters to always keep visible. */
  tail?: number;
  className?: string;
}) {
  // Short enough to show whole — no split (keeps the value a single text node).
  if (text.length <= tail + 1) {
    return <span className={`truncate ${className}`} title={text}>{text}</span>;
  }
  const head = text.slice(0, text.length - tail);
  const end = text.slice(text.length - tail);
  return (
    <span className={`flex items-baseline min-w-0 ${className}`} title={text}>
      <span className="truncate min-w-0">{head}</span>
      <span className="shrink-0">{end}</span>
    </span>
  );
}
