import { Workflow, ShieldCheck, Settings, Wand2 } from 'lucide-react';
import { typeColor } from '../../../lib/type-color';

type WorkflowVariant = 'durable' | 'configured' | 'certified' | 'pipeline';

interface WorkflowPillProps {
  type: string;
  size?: 'xs' | 'sm' | 'md';
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
    ? 'px-2.5 py-0.5 gap-1.5'
    : size === 'xs'
      ? 'px-1 py-px gap-0.5'
      : 'px-1.5 py-px gap-1';
  const fontSize = size === 'md' ? '13px' : size === 'xs' ? '9px' : '11px';
  const iconClass = size === 'md' ? 'w-3.5 h-3.5' : size === 'xs' ? 'w-2 h-2' : 'w-2.5 h-2.5';

  const resolved = variant ?? (certified ? 'certified' : 'durable');
  const Icon = VARIANT_ICON[resolved];

  // Pipeline and durable variants get a type-name-derived color.
  // Certified and configured keep their fixed semantic colors.
  const fixedColor = VARIANT_FIXED_COLOR[resolved];
  const derived = fixedColor ? null : typeColor(type);
  const iconColor = fixedColor || (derived?.text ?? 'text-accent/75');

  return (
    <span className={`inline-flex items-center ${sizeClass} font-mono text-text-secondary border border-surface-border rounded-lg`} style={{ fontSize, lineHeight: 1.1 }}>
      <Icon className={`${iconClass} shrink-0 ${iconColor}`} />
      {type}
    </span>
  );
}
