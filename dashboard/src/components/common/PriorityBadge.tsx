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

export function PriorityBadge({ priority }: { priority: number }) {
  return (
    <span className={`text-xs ${priorityStyles[priority] ?? 'text-text-secondary'}`}>
      {priorityLabels[priority] ?? `P${priority}`}
    </span>
  );
}
