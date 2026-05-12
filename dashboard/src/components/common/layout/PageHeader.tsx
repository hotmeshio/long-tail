import type { ReactNode } from 'react';
import { BookOpen } from 'lucide-react';

interface PageHeaderProps {
  title: string;
  actions?: ReactNode;
  /** Hash link to open the docs drawer to a specific section, e.g. "#docs=dashboard.md#workflow-registry" */
  docsHash?: string;
}

export function PageHeader({ title, actions, docsHash }: PageHeaderProps) {
  return (
    <div className="flex items-center gap-4 mb-10">
      <div className="flex items-center gap-2 flex-1">
        <h1 className="text-3xl font-light text-text-primary">{title}</h1>
        {docsHash && (
          <button
            onClick={() => { window.location.hash = docsHash; }}
            className="text-text-quaternary hover:text-accent transition-colors mt-1"
            title="Open docs for this page"
          >
            <BookOpen className="w-4 h-4" strokeWidth={1.5} />
          </button>
        )}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}
