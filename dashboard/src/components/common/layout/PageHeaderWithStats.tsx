import type { ReactNode } from 'react';
import { BookOpen } from 'lucide-react';

export interface InlineStat {
  label: string;
  value: string | number;
  dotClass?: string;
}

interface PageHeaderWithStatsProps {
  title: string;
  subtitle?: string;
  stats?: InlineStat[];
  actions?: ReactNode;
  docsHash?: string;
}

export function PageHeaderWithStats({
  title,
  subtitle,
  stats,
  actions,
  docsHash,
}: PageHeaderWithStatsProps) {
  return (
    <div className="flex items-baseline justify-between mb-10">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <h1 className="heading-1">{title}</h1>
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
        {subtitle && (
          <span className="text-sm text-text-tertiary font-light">{subtitle}</span>
        )}
      </div>
      <div className="flex items-center gap-5">
        {stats?.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5 text-xs text-text-tertiary">
            {s.dotClass && <span className={`w-1.5 h-1.5 rounded-full dot-ring ${s.dotClass}`} />}
            <span>{s.label}</span>
            <span className="font-medium text-text-secondary">{s.value}</span>
          </div>
        ))}
        {actions && <div className="flex items-center gap-3">{actions}</div>}
      </div>
    </div>
  );
}
