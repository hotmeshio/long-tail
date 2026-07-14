import { useState, useEffect, useRef, type ReactNode } from 'react';

interface FilterBarProps {
  children: ReactNode;
  actions?: ReactNode;
}

export function FilterBar({ children, actions }: FilterBarProps) {
  return (
    <div className="sticky top-0 z-20 bg-surface pt-3 pb-3">
      <div className="bg-surface-sunken rounded-lg px-5 py-2">
        <div className="flex items-center gap-5 flex-wrap">
          {children}
          {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
        </div>
      </div>
    </div>
  );
}

export function FilterDivider() {
  return <span className="h-3.5 w-px bg-surface-border shrink-0 self-center -mr-3" />;
}

interface FilterSelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  /** When true, omit the default "All" option — a value is always required. */
  required?: boolean;
  placeholder?: string;
}

export function FilterSelect({ label, value, onChange, options, required, placeholder }: FilterSelectProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-[10px] font-medium text-text-tertiary whitespace-nowrap">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="select text-[11px] py-0.5 pl-0 pr-4"
      >
        {!required && <option value="">{placeholder || 'All'}</option>}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

interface FilterInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function FilterInput({ label, value, onChange, placeholder }: FilterInputProps) {
  const [local, setLocal] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Sync from parent when the URL-driven value changes externally
  useEffect(() => { setLocal(value); }, [value]);

  const handleChange = (v: string) => {
    setLocal(v);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onChange(v), 300);
  };

  // Flush on unmount
  useEffect(() => () => clearTimeout(timerRef.current), []);

  return (
    <div className="flex items-center gap-1.5">
      <label className="text-[10px] text-text-tertiary whitespace-nowrap">{label}</label>
      <input
        type="text"
        value={local}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        className="input text-[11px] py-1 px-2 w-36 font-mono"
      />
    </div>
  );
}
