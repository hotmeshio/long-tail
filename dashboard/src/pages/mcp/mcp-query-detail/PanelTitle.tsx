import type { LucideIcon } from 'lucide-react';

export function PanelTitle({ title, subtitle, icon: Icon, iconClass }: {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  iconClass?: string;
}) {
  return (
    <div className="mb-6">
      <h2 className="text-lg font-light text-text-primary flex items-center gap-2">
        {Icon && <Icon className={`w-4.5 h-4.5 ${iconClass || 'text-text-tertiary'}`} strokeWidth={1.5} />}
        {title}
      </h2>
      {subtitle && <p className="text-xs text-text-tertiary mt-0.5">{subtitle}</p>}
    </div>
  );
}
