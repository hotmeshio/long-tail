import { Workflow, ShieldCheck, Wand2 } from 'lucide-react';

type WorkflowVariant = 'durable' | 'certified' | 'pipeline';

interface WorkflowPillProps {
  type: string;
  size?: 'sm' | 'md';
  /** @deprecated Use `variant` instead */
  certified?: boolean;
  variant?: WorkflowVariant;
}

const VARIANT_CONFIG: Record<WorkflowVariant, { icon: typeof Workflow; color: string }> = {
  certified: { icon: ShieldCheck, color: 'text-status-success' },
  pipeline:  { icon: Wand2,       color: 'text-purple-400' },
  durable:   { icon: Workflow,     color: 'text-accent/75' },
};

export function WorkflowPill({ type, size = 'sm', certified, variant }: WorkflowPillProps) {
  const sizeClass = size === 'md'
    ? 'px-2.5 py-0.5 text-[11px] gap-1.5'
    : 'px-2 py-0.5 text-[10px] gap-1';
  const iconClass = size === 'md' ? 'w-3 h-3' : 'w-2.5 h-2.5';

  const resolved = variant ?? (certified ? 'certified' : 'durable');
  const { icon: Icon, color: iconColor } = VARIANT_CONFIG[resolved];

  return (
    <span className={`inline-flex items-center ${sizeClass} font-mono bg-accent/[0.06] text-text-secondary rounded-lg`}>
      <Icon className={`${iconClass} shrink-0 ${iconColor}`} />
      {type}
    </span>
  );
}
