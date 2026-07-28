/**
 * The scan-code structure as a "you are here" schematic: three mono segments,
 * the one this page configures carried in accent on the light accent wash,
 * the others muted. The accent marks the active target of the page — the
 * same small-dose accent role a section label plays.
 */
export function CodeShape({ highlight }: { highlight: 'version' | 'category' | 'target' }) {
  const segment = (name: 'version' | 'category' | 'target') =>
    name === highlight
      ? 'text-accent bg-accent/10 rounded-sm px-1 font-semibold'
      : 'text-text-tertiary';
  return (
    <span className="font-mono whitespace-nowrap">
      <span className={segment('version')}>version</span>
      <span className="text-text-quaternary">:</span>
      <span className={segment('category')}>category</span>
      <span className="text-text-quaternary">:</span>
      <span className={segment('target')}>target</span>
    </span>
  );
}
