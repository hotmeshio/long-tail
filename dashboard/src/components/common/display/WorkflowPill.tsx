import { Workflow, ShieldCheck, SlidersHorizontal, Wand2, Zap } from 'lucide-react';

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

const SIZE_CONFIG = {
  xs: { pill: 'px-1 py-px text-[9px] gap-1', icon: 'w-2 h-2' },
  sm: { pill: 'px-1.5 py-px text-[11px] gap-1', icon: 'w-2 h-2' },
  md: { pill: 'px-2 py-0.5 text-[12px] gap-1.5', icon: 'w-2.5 h-2.5' },
} as const;

/**
 * Universal workflow name chip — mono label with a small tier icon
 * (shield = certified, sliders = registered, wand = pipeline, bolt =
 * capability, workflow = durable). Neutral by design; the icon carries
 * the tier, not color. Matches ToolPill styling.
 */
export function WorkflowPill({ type, size = 'sm', certified, variant }: WorkflowPillProps) {
  const resolved = variant ?? (certified ? 'certified' : 'durable');
  // Callers pass server-provided tier strings here — fall back to the durable
  // icon on an unrecognized value so version skew degrades instead of crashing.
  const Icon = VARIANT_ICON[resolved] ?? Workflow;
  const s = SIZE_CONFIG[size];

  return (
    <span className={`inline-flex items-center ${s.pill} font-mono text-text-secondary bg-surface-sunken/50 rounded-md`}>
      <Icon className={`${s.icon} shrink-0 text-text-quaternary`} strokeWidth={1.5} />
      {type}
    </span>
  );
}
