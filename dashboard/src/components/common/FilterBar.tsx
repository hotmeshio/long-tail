import type { ReactNode } from 'react';

interface FilterBarProps {
  children: ReactNode;
  actions?: ReactNode;
}

export function FilterBar({ children, actions }: FilterBarProps) {
  return (
    <div className="sticky top-0 z-20 bg-surface -mx-10 px-10 py-1.5 pb-4 border-b border-surface-border/50">
      <div className="flex items-center gap-2 flex-wrap">
        {children}
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

interface FilterSelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}

export function FilterSelect({ label, value, onChange, options }: FilterSelectProps) {
  return (
    <div className="flex items-center gap-1.5">
      <label className="text-[10px] text-text-tertiary">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="select text-[11px] py-1 px-2"
      >
        <option value="">All</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
