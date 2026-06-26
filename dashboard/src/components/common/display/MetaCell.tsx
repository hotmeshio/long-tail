import type { ReactNode } from 'react';

// Successive tiers step the font, line spacing, and fill down a notch so stacked
// rows read as one unit — each row's background is half the opacity of the one
// above it. Tiny gaps between cells keep a row feeling like a single rectangle.
const TIER = {
  1: { pad: 'px-3 py-2.5', label: 'text-[9px] mb-1.5', value: 'text-xs', bg: 'bg-surface-sunken/60' },
  2: { pad: 'px-3 py-2', label: 'text-[8px] mb-1', value: 'text-[11px]', bg: 'bg-surface-sunken/30' },
  3: { pad: 'px-2.5 py-1.5', label: 'text-[8px] mb-0.5', value: 'text-[10px]', bg: 'bg-surface-sunken/15' },
} as const;

/**
 * A single labelled metadata cell: a borderless, light-fill rounded box that
 * grows to fill its share of the row (flex-1) so a set of them distributes
 * evenly across the full width. `tier` scales the type down for nested rows.
 */
export function MetaCell({
  label,
  children,
  tier = 1,
  className = '',
}: {
  label: string;
  children: ReactNode;
  tier?: 1 | 2 | 3;
  className?: string;
}) {
  const t = TIER[tier];
  return (
    <div className={`flex-1 min-w-0 rounded-lg ${t.bg} ${t.pad} ${className}`}>
      <p className={`font-semibold uppercase tracking-widest text-text-tertiary leading-none ${t.label}`}>
        {label}
      </p>
      <div className={`text-text-secondary leading-tight min-w-0 ${t.value}`}>{children}</div>
    </div>
  );
}
