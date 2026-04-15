import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function PanelTitle({ title, subtitle, icon: Icon, iconClass, actions }: {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  iconClass?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h2 className="text-lg font-light text-text-primary flex items-center gap-2">
          {Icon && <Icon className={`w-4.5 h-4.5 ${iconClass || 'text-text-tertiary'}`} strokeWidth={1.5} />}
          {title}
        </h2>
        {subtitle && <p className="text-xs text-text-tertiary mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-3 shrink-0">{actions}</div>}
    </div>
  );
}
