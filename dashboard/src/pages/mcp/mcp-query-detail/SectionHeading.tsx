/**
 * A thin section divider: uppercase label with a trailing border line.
 * Reused across multiple wizard panels.
 */
export function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="text-xs font-semibold uppercase tracking-widest text-text-tertiary">{children}</span>
      <span className="flex-1 border-b border-surface-border" />
    </div>
  );
}
