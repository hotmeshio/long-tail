import type { ReactNode } from 'react';

export interface SegmentedTab<K extends string> {
  key: K;
  label: string;
  /** Optional leading glyph, sized w-3.5 h-3.5 to match the pill height. */
  icon?: ReactNode;
}

/**
 * A pill segmented control — a row of radio-style links where one is active. The
 * modern alternative to an accordion: instead of toggling sections open and
 * closed, the tabs sit at the top and each selection reveals its section. One
 * quiet band (surface-sunken), the active tab in the accent tint, the rest a
 * muted neutral that warms on hover. Reused across the product (account kinds,
 * execution sections) so every segmented switch looks and behaves the same.
 */
export function SegmentedTabs<K extends string>({ tabs, active, onChange, className = '', 'aria-label': ariaLabel }: {
  tabs: SegmentedTab<K>[];
  active: K;
  onChange: (key: K) => void;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`inline-flex gap-1 p-0.5 bg-surface-sunken rounded-lg w-fit ${className}`}
    >
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
              isActive
                ? 'bg-accent/10 text-accent font-medium'
                : 'text-text-tertiary hover:text-text-secondary hover:bg-surface-hover'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
