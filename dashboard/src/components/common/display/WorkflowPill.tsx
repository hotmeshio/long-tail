import { Workflow, ShieldCheck } from 'lucide-react';

interface WorkflowPillProps {
  type: string;
  size?: 'sm' | 'md';
  certified?: boolean;
}

export function WorkflowPill({ type, size = 'sm', certified }: WorkflowPillProps) {
  const sizeClass = size === 'md'
    ? 'px-2.5 py-0.5 text-[11px] gap-1.5'
    : 'px-2 py-0.5 text-[10px] gap-1';
  const iconClass = size === 'md' ? 'w-3 h-3' : 'w-2.5 h-2.5';

  const Icon = certified ? ShieldCheck : Workflow;
  const iconColor = certified ? 'text-status-success' : 'text-accent/75';

  return (
    <span className={`inline-flex items-center ${sizeClass} font-mono bg-accent/[0.06] text-text-secondary rounded-lg`}>
      <Icon className={`${iconClass} shrink-0 ${iconColor}`} />
      {type}
    </span>
  );
}
