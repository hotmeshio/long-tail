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
}: {
  icon: LucideIcon;
  title: string;
  onClick: (e: React.MouseEvent) => void;
  colorClass?: string;
  alwaysVisible?: boolean;
}) {
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
      <Icon className="w-[18px] h-[18px]" strokeWidth={1.5} />
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
