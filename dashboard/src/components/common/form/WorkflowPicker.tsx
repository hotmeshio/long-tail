import { useState, useRef, useEffect } from 'react';
import { Workflow, X, ChevronDown, Check } from 'lucide-react';

interface WorkflowPickerProps {
  options: string[];
  selected: string[];
  onChange: (workflows: string[]) => void;
  placeholder?: string;
}

export function WorkflowPicker({ options, selected, onChange, placeholder }: WorkflowPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = (wfType: string) => {
    onChange(
      selected.includes(wfType)
        ? selected.filter((t) => t !== wfType)
        : [...selected, wfType],
    );
  };

  const remove = (wfType: string) => {
    onChange(selected.filter((t) => t !== wfType));
  };

  const placeholderText = placeholder ?? 'Add workflows...';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex flex-wrap items-center gap-1.5 w-full min-h-[34px] px-2 py-1.5 bg-surface-sunken border border-surface-border rounded-md text-left cursor-pointer hover:border-accent/40 transition-colors focus:ring-1 focus:ring-accent focus:outline-none"
      >
        {selected.length === 0 && (
          <span className="text-xs text-text-tertiary">{placeholderText}</span>
        )}
        {selected.map((wfType) => (
          <span
            key={wfType}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-accent/[0.08] text-text-secondary text-[11px] font-mono"
          >
            <Workflow className="w-2.5 h-2.5 shrink-0 text-accent/75" />
            {wfType}
            <span
              role="button"
              onClick={(e) => { e.stopPropagation(); remove(wfType); }}
              className="ml-0.5 hover:text-status-error transition-colors"
            >
              <X className="w-2.5 h-2.5" />
            </span>
          </span>
        ))}
        <ChevronDown className={`w-3.5 h-3.5 ml-auto shrink-0 text-text-tertiary transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-surface-border rounded-md shadow-lg max-h-48 overflow-y-auto">
          {options.length === 0 ? (
            <p className="px-3 py-2 text-xs text-text-tertiary">No registered workflows</p>
          ) : (
            options.map((wfType) => {
              const isSelected = selected.includes(wfType);
              return (
                <button
                  key={wfType}
                  type="button"
                  onClick={() => toggle(wfType)}
                  className={`flex items-center gap-2 w-full px-3 py-1.5 text-left text-xs font-mono transition-colors ${
                    isSelected
                      ? 'bg-accent/[0.06] text-accent'
                      : 'text-text-primary hover:bg-surface-sunken'
                  }`}
                >
                  <Workflow className="w-3 h-3 shrink-0 text-accent/60" />
                  <span className="flex-1">{wfType}</span>
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
