import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { deriveRoleTitle } from '../../lib/role-display';

export interface RoleTitleOption {
  value: string;
  /** Display title — a user-set role title, else derived from the role id. */
  label: string;
}

/**
 * The page title IS the queue selector. When a role is active it reads as that
 * role's title (the queue you're looking at); with no role it reads "All
 * Escalations". Clicking opens a menu to switch queues or return to all — so
 * the page is about the role/queue, not the generic fact of an escalation.
 */
export function EscalationTitleSelect({
  role,
  options,
  onChange,
}: {
  role: string;
  options: RoleTitleOption[];
  onChange: (role: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = role
    ? (options.find((o) => o.value === role)?.label ?? deriveRoleTitle(role))
    : 'All Escalations';

  const itemCls = (active: boolean) =>
    `w-full text-left px-3 py-1.5 text-sm flex items-baseline gap-2 transition-colors ${
      active ? 'text-accent bg-accent/5' : 'text-text-primary hover:bg-surface-hover'
    }`;

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex items-center gap-2 min-w-0 text-3xl font-light text-text-primary hover:text-accent transition-colors"
      >
        <span className="truncate">{current}</span>
        <ChevronDown
          className={`w-6 h-6 shrink-0 text-text-tertiary group-hover:text-accent transition-transform ${open ? 'rotate-180' : ''}`}
          strokeWidth={1.5}
        />
      </button>

      {open && (
        <div className="absolute z-[100] top-full left-0 mt-2 min-w-[16rem] max-h-80 overflow-y-auto bg-surface-raised border border-surface-border rounded-md shadow-lg py-1">
          <button type="button" onClick={() => { onChange(''); setOpen(false); }} className={itemCls(!role)}>
            All Escalations
          </button>
          {options.length > 0 && <div className="h-px bg-surface-border my-1" />}
          {options.map((o) => (
            <button key={o.value} type="button" onClick={() => { onChange(o.value); setOpen(false); }} className={itemCls(role === o.value)}>
              <span className="truncate">{o.label}</span>
              {o.label !== o.value && <span className="text-[10px] font-mono text-text-quaternary shrink-0">{o.value}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
