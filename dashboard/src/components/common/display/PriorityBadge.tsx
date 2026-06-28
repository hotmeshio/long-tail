const priorityLabels: Record<number, string> = {
  1: 'P1',
  2: 'P2',
  3: 'P3',
  4: 'P4',
};

const priorityStyles: Record<number, string> = {
  1: 'text-text-primary font-semibold',
  2: 'text-text-primary font-medium',
  3: 'text-text-secondary',
  4: 'text-text-tertiary',
};

// Severity weight without colour, for the `inherit` tone (colour comes from the row).
const priorityWeight: Record<number, string> = {
  1: 'font-semibold',
  2: 'font-medium',
};

export function PriorityBadge({
  priority,
  size = 'md',
  tone = 'severity',
}: {
  priority: number;
  size?: 'sm' | 'md';
  /** `severity` colours by priority; `inherit` takes the surrounding text colour. */
  tone?: 'severity' | 'inherit';
}) {
  const sizeClass = size === 'sm' ? 'text-[11px]' : 'text-xs';
  const toneClass =
    tone === 'inherit'
      ? `text-inherit ${priorityWeight[priority] ?? ''}`
      : priorityStyles[priority] ?? 'text-text-secondary';
  return (
    <span className={`${sizeClass} ${toneClass}`}>
      {priorityLabels[priority] ?? `P${priority}`}
    </span>
  );
}
