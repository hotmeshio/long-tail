import { useState, useRef, useEffect } from 'react';
import { User, X, ChevronDown, Check } from 'lucide-react';
import { useRoles } from '../../../api/roles';

interface RolePickerProps {
  selected: string[];
  onChange: (roles: string[]) => void;
  /** Only allow one selection */
  single?: boolean;
  placeholder?: string;
}

export function RolePicker({ selected, onChange, single, placeholder }: RolePickerProps) {
  const { data } = useRoles();
  const allRoles = data?.roles ?? [];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = (role: string) => {
    if (single) {
      onChange(selected.includes(role) ? [] : [role]);
      setOpen(false);
    } else {
      onChange(
        selected.includes(role)
          ? selected.filter((r) => r !== role)
          : [...selected, role],
      );
    }
  };

  const remove = (role: string) => {
    onChange(selected.filter((r) => r !== role));
  };

  const placeholderText = placeholder ?? (single ? 'Select role...' : 'Add roles...');

  return (
    <div ref={ref} className="relative">
      {/* Selected pills + trigger */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex flex-wrap items-center gap-1.5 w-full min-h-[34px] px-2 py-1.5 bg-surface-sunken border border-surface-border rounded-md text-left cursor-pointer hover:border-accent/40 transition-colors focus:ring-1 focus:ring-accent focus:outline-none"
      >
        {selected.length === 0 && (
          <span className="text-xs text-text-tertiary">{placeholderText}</span>
        )}
        {selected.map((role) => (
          <span
            key={role}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-accent/[0.08] text-text-secondary text-[11px]"
          >
            <User className="w-2.5 h-2.5 shrink-0 text-accent/75" />
            {role}
            <span
              role="button"
              onClick={(e) => { e.stopPropagation(); remove(role); }}
              className="ml-0.5 hover:text-status-error transition-colors"
            >
              <X className="w-2.5 h-2.5" />
            </span>
          </span>
        ))}
        <ChevronDown className={`w-3.5 h-3.5 ml-auto shrink-0 text-text-tertiary transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-surface-border rounded-md shadow-lg max-h-48 overflow-y-auto">
          {allRoles.length === 0 ? (
            <p className="px-3 py-2 text-xs text-text-tertiary">No roles defined</p>
          ) : (
            allRoles.map((role) => {
              const isSelected = selected.includes(role);
              return (
                <button
                  key={role}
                  type="button"
                  onClick={() => toggle(role)}
                  className={`flex items-center gap-2 w-full px-3 py-1.5 text-left text-xs transition-colors ${
                    isSelected
                      ? 'bg-accent/[0.06] text-accent'
                      : 'text-text-primary hover:bg-surface-sunken'
                  }`}
                >
                  <User className="w-3 h-3 shrink-0 text-accent/60" />
                  <span className="flex-1">{role}</span>
                  {isSelected && <Check className="w-3 h-3 shrink-0" />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
