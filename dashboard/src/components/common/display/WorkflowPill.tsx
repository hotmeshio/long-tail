import { Workflow, ShieldCheck, SlidersHorizontal, Wand2, Zap } from 'lucide-react';
import { typeColor } from '../../../lib/type-color';

type WorkflowVariant = 'durable' | 'registered' | 'certified' | 'pipeline' | 'capability';

interface WorkflowPillProps {
  type: string;
  size?: 'xs' | 'sm' | 'md';
  /** @deprecated Use `variant` instead */
  certified?: boolean;
  variant?: WorkflowVariant;
}

const VARIANT_ICON: Record<WorkflowVariant, typeof Workflow> = {
  certified:  ShieldCheck,
  registered: SlidersHorizontal,
  pipeline:   Wand2,
  capability: Zap,
  durable:    Workflow,
};

const VARIANT_FIXED_COLOR: Record<string, { text: string; bg: string }> = {
  certified:  { text: 'text-status-success', bg: 'bg-status-success/10' },
  registered: { text: 'text-amber-500/70', bg: 'bg-amber-200/[0.12]' },
};

const SIZE_CONFIG = {
  xs: { bulb: 'w-4 h-4', icon: 'w-2 h-2', text: 'text-[9px]', pad: 'pr-1.5 pl-0.5', gap: '-ml-1' },
  sm: { bulb: 'w-5 h-5', icon: 'w-2.5 h-2.5', text: 'text-[11px]', pad: 'pr-2 pl-1', gap: '-ml-1.5' },
  md: { bulb: 'w-6 h-6', icon: 'w-3 h-3', text: 'text-[13px]', pad: 'pr-2.5 pl-1.5', gap: '-ml-2' },
} as const;

export function WorkflowPill({ type, size = 'sm', certified, variant }: WorkflowPillProps) {
  const resolved = variant ?? (certified ? 'certified' : 'durable');
  // Callers pass server-provided tier strings here — fall back to the durable
  // icon on an unrecognized value so version skew degrades instead of crashing.
  const Icon = VARIANT_ICON[resolved] ?? Workflow;
  const s = SIZE_CONFIG[size];

  const fixed = VARIANT_FIXED_COLOR[resolved];
  const derived = fixed ? null : typeColor(type);
  const iconColor = fixed?.text ?? derived?.text ?? 'text-accent/75';
  const bgColor = fixed?.bg ?? derived?.bg ?? 'bg-accent/[0.08]';

  return (
    <span className="inline-flex items-center">
      {/* Bulb — circular icon container */}
      <span className={`${s.bulb} rounded-full ${bgColor} inline-flex items-center justify-center shrink-0 z-[1]`}>
        <Icon className={`${s.icon} ${iconColor}`} />
      </span>
      {/* Label — extends right, overlapping the bulb */}
      <span
        className={`${s.gap} ${s.pad} ${bgColor} rounded-r-full font-mono text-text-secondary`}
        style={{ fontSize: s.text === 'text-[9px]' ? '9px' : s.text === 'text-[11px]' ? '11px' : '13px', lineHeight: 1.4 }}
      >
        {type}
      </span>
    </span>
  );
}
