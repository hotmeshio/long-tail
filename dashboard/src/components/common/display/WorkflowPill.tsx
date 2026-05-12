import { Workflow, ShieldCheck, Settings, Wand2 } from 'lucide-react';
import { typeColor } from '../../../lib/type-color';

type WorkflowVariant = 'durable' | 'configured' | 'certified' | 'pipeline';

interface WorkflowPillProps {
  type: string;
  size?: 'sm' | 'md';
  /** @deprecated Use `variant` instead */
  certified?: boolean;
  variant?: WorkflowVariant;
}

const VARIANT_ICON: Record<WorkflowVariant, typeof Workflow> = {
  certified:  ShieldCheck,
  configured: Settings,
  pipeline:   Wand2,
  durable:    Workflow,
};

const VARIANT_FIXED_COLOR: Record<string, string> = {
  certified:  'text-status-success',
  configured: 'text-status-info',
};

export function WorkflowPill({ type, size = 'sm', certified, variant }: WorkflowPillProps) {
  const sizeClass = size === 'md'
    ? 'px-2.5 py-0.5 text-[13px] gap-1.5'
    : 'px-2 py-0.5 text-[10px] gap-1';
  const iconClass = size === 'md' ? 'w-3.5 h-3.5' : 'w-2.5 h-2.5';

  const resolved = variant ?? (certified ? 'certified' : 'durable');
  const Icon = VARIANT_ICON[resolved];

  // Pipeline and durable variants get a type-name-derived color.
  // Certified and configured keep their fixed semantic colors.
  const fixedColor = VARIANT_FIXED_COLOR[resolved];
  const derived = fixedColor ? null : typeColor(type);
  const iconColor = fixedColor || (derived?.text ?? 'text-accent/75');
  const bgColor = derived?.bg ?? 'bg-accent/[0.06]';

  return (
    <span className={`inline-flex items-center ${sizeClass} font-mono ${bgColor} text-text-secondary rounded-lg`}>
      <Icon className={`${iconClass} shrink-0 ${iconColor}`} />
      {type}
    </span>
  );
}
