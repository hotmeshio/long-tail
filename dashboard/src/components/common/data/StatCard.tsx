interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  dotClass?: string;
  colorClass?: string;
  onClick?: () => void;
}

export function StatCard({
  label,
  value,
  sub,
  dotClass,
  colorClass = 'text-text-primary',
  onClick,
}: StatCardProps) {
  const content = (
    <>
      <div className="flex items-center gap-2 mb-1">
        {dotClass && <span className={`w-2 h-2 rounded-full ${dotClass}`} />}
        <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
          {label}
        </p>
      </div>
      <p className={`text-2xl font-light tabular-nums ${colorClass}`}>{value}</p>
      {sub && <p className="text-xs text-text-tertiary mt-1">{sub}</p>}
    </>
  );

  const base = 'bg-surface-raised border border-surface-border rounded-md p-4 text-left';

  if (onClick) {
    return (
      <button onClick={onClick} className={`${base} hover:border-accent/40 transition-colors`}>
        {content}
      </button>
    );
  }

  return <div className={base}>{content}</div>;
}
