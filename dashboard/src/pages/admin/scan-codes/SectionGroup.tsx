/** A titled settings group on the scheme page. */
export function SectionGroup({
  icon: Icon,
  label,
  annotation,
  aside,
  children,
}: {
  icon: React.ElementType;
  label: string;
  annotation?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-1.5 min-w-0">
          <Icon className="w-3 h-3 text-text-tertiary shrink-0" strokeWidth={1.5} />
          <span className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary">{label}</span>
          {annotation && <span className="text-2xs text-text-quaternary truncate">— {annotation}</span>}
        </div>
        {aside}
      </div>
      <div className="border-l-2 pl-5 border-surface-border/60">{children}</div>
    </div>
  );
}

/**
 * One scheme's rules. The category grid selects a two-digit slot; the rule
 * editor beneath walks the 1-2-3: name the rule, order its condition
 * queries, and set each step's action and the no-match fallback.
 */
