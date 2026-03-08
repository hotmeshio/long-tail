import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  /** @deprecated Browser provides back navigation */
  backTo?: string;
  /** @deprecated Browser provides back navigation */
  backLabel?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, actions }: PageHeaderProps) {
  return (
    <div className="flex items-center gap-4 mb-10">
      <h1 className="text-3xl font-light text-text-primary flex-1">{title}</h1>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}
