import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface PageHeaderProps {
  title: string;
  backTo?: string;
  backLabel?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, backTo, backLabel, actions }: PageHeaderProps) {
  return (
    <div className="flex items-center gap-4 mb-10">
      {backTo && (
        <Link to={backTo} className="text-xs text-text-tertiary hover:text-text-primary">
          &larr; {backLabel ?? 'Back'}
        </Link>
      )}
      <h1 className="text-3xl font-light text-text-primary flex-1">{title}</h1>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}
