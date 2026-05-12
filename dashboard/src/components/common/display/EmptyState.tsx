import type { LucideIcon } from 'lucide-react';

export function EmptyState({
  title = 'No data',
  description,
  icon: Icon,
}: {
  title?: string;
  description?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      {Icon && (
        <div className="w-12 h-12 rounded-full bg-accent/[0.06] flex items-center justify-center mb-4">
          <Icon className="w-5 h-5 text-accent/50" />
        </div>
      )}
      <p className="text-sm text-text-secondary">{title}</p>
      {description && (
        <p className="text-xs text-text-tertiary mt-1">{description}</p>
      )}
    </div>
  );
}
