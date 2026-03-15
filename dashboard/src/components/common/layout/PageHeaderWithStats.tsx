import type { ReactNode } from 'react';

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
}

export function PageHeaderWithStats({
  title,
  subtitle,
  stats,
  actions,
}: PageHeaderWithStatsProps) {
  return (
    <div className="flex items-baseline justify-between mb-10">
      <div className="flex items-center gap-4">
        <h1 className="text-3xl font-light text-text-primary">{title}</h1>
        {subtitle && (
          <span className="text-sm text-text-tertiary font-light">{subtitle}</span>
        )}
      </div>
      <div className="flex items-center gap-5">
        {stats?.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5 text-xs text-text-tertiary">
            {s.dotClass && <span className={`w-1.5 h-1.5 rounded-full ${s.dotClass}`} />}
            <span>{s.label}</span>
            <span className="font-medium text-text-secondary">{s.value}</span>
          </div>
        ))}
        {actions && <div className="flex items-center gap-3">{actions}</div>}
      </div>
    </div>
  );
}
