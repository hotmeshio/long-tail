import type { ReactNode } from 'react';

export function PanelTitle({ title, subtitle, actions }: {
  title: string;
  subtitle?: string;
  icon?: unknown;
  iconClass?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h2 className="text-2xl font-extralight tracking-wide text-accent/75 mb-1">{title}</h2>
        {subtitle && <p className="text-base text-text-secondary">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-3 shrink-0">{actions}</div>}
    </div>
  );
}
