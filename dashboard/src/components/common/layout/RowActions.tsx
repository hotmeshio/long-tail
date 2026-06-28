import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Ephemeral icon button that appears on row hover.
 * Uses `group-hover/row:opacity-100` to show on hover — rows must have `group/row`.
 */
export function RowAction({
  icon: Icon,
  title,
  onClick,
  colorClass = 'text-text-tertiary hover:text-accent',
  alwaysVisible,
  size = 'md',
}: {
  icon: LucideIcon;
  title: string;
  onClick: (e: React.MouseEvent) => void;
  colorClass?: string;
  alwaysVisible?: boolean;
  /** `md` is the standard 18px action; `sm` is a tighter 16px icon. */
  size?: 'sm' | 'md';
}) {
  const iconSize = size === 'sm' ? 'w-4 h-4' : 'w-[18px] h-[18px]';
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      className={`transition-opacity ${
        alwaysVisible ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100'
      } ${colorClass}`}
      title={title}
    >
      <Icon className={iconSize} strokeWidth={1.5} />
    </button>
  );
}

/**
 * Container for one or more RowAction icons in the last table column.
 */
export function RowActionGroup({ children }: { children: ReactNode }) {
  return (
    <span className="flex items-center justify-end gap-2.5">
      {children}
    </span>
  );
}
