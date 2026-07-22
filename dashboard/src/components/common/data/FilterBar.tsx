import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { useShellPanelOptional } from '../../../hooks/useShellPanel';

/**
 * Filter layout context — the same controlled FilterSelect/FilterInput
 * children render inline in the bar (label beside control) or stacked in the
 * shell panel (label above control, full width). State stays URL-driven, so
 * the two surfaces are always in sync.
 */
const FilterLayoutContext = createContext<'inline' | 'stacked'>('inline');

interface FilterBarProps {
  children: ReactNode;
  actions?: ReactNode;
  /** Count for the folded Filters button's badge (active, non-default filters). */
  activeFilterCount?: number;
}

/**
 * The filter band. Geometry follows the container: at `@filters` width the
 * controls render inline and wrap as whole units; below it they fold behind
 * one Filters button that opens the same controls, stacked, in the shell's
 * right panel. The outer div stays sticky — sticky elements are never
 * containers, so the container sits on the inner band.
 */
export function FilterBar({ children, actions, activeFilterCount }: FilterBarProps) {
  // Outside the shell (tests, standalone surfaces) there is no panel to fold
  // into — the fold button becomes inert and inline mode carries the day.
  const shellPanel = useShellPanelOptional();
  const setPanel = shellPanel?.setPanel;
  const closePanel = shellPanel?.closePanel;
  const panelOpen = shellPanel?.open ?? false;
  const [foldOpen, setFoldOpen] = useState(false);

  // Keep the panel content live while it is open — the children are
  // controlled by URL params, so each change re-renders the stacked copy.
  useEffect(() => {
    if (!foldOpen || !setPanel) return;
    setPanel(
      <StackedFilterPanel onClose={() => setFoldOpen(false)}>{children}</StackedFilterPanel>,
      { width: 320 },
    );
  }, [foldOpen, children, setPanel]);

  // The shell panel can close from anywhere (route change, its own X) —
  // follow it so the button state never lies.
  useEffect(() => {
    if (!panelOpen && foldOpen) setFoldOpen(false);
  }, [panelOpen, foldOpen]);

  useEffect(() => {
    if (!foldOpen || !closePanel) return;
    return () => closePanel();
  }, [foldOpen, closePanel]);

  return (
    <div className="sticky top-0 z-20 bg-surface pt-3 pb-3">
      <div className="bg-surface-sunken rounded-lg px-4 py-2.5 @container/filters">
        {/* One row, one actions slot. The children swap geometry: inline
            controls at @filters width, one Filters button below it. */}
        <div className="flex items-center gap-x-4 gap-y-2 flex-wrap">
          <div className="hidden @filters/filters:contents">{children}</div>
          <button
            onClick={() => setFoldOpen((v) => !v)}
            className="@filters/filters:hidden inline-flex items-center gap-1.5 text-xs font-medium text-text-secondary hover:text-text-primary transition-colors"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Filters
            {activeFilterCount != null && activeFilterCount > 0 && (
              <span className="rounded-full bg-accent/10 text-accent px-1.5 text-2xs tabular-nums font-semibold">
                {activeFilterCount}
              </span>
            )}
          </button>
          {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
        </div>
      </div>
    </div>
  );
}

function StackedFilterPanel({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 bg-surface-raised border-b border-surface-border/50">
        <span className="text-xs font-semibold text-text-primary">Filters</span>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-surface-hover text-text-tertiary hover:text-text-primary transition-colors"
          title="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="px-4 py-3 space-y-4">
        <FilterLayoutContext.Provider value="stacked">
          {children}
        </FilterLayoutContext.Provider>
      </div>
    </div>
  );
}

/**
 * @deprecated The pipe separator is retired — the field fill + gap already
 * separate filters. Kept as a no-op so existing call sites don't break.
 */
export function FilterDivider() {
  return null;
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
  const layout = useContext(FilterLayoutContext);
  return (
    <div className={layout === 'stacked' ? 'flex flex-col gap-1' : 'flex items-center gap-2'}>
      <label className="text-2xs font-medium text-text-tertiary whitespace-nowrap">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`select text-2xs py-1 ${layout === 'stacked' ? 'w-full' : 'w-auto min-w-[6rem]'}`}
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
  const layout = useContext(FilterLayoutContext);
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
    <div className={layout === 'stacked' ? 'flex flex-col gap-1' : 'flex items-center gap-2'}>
      <label className="text-2xs font-medium text-text-tertiary whitespace-nowrap">{label}</label>
      <input
        type="text"
        value={local}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        className={`input text-2xs py-1 font-mono ${layout === 'stacked' ? 'w-full' : 'w-36 min-w-0 max-w-full'}`}
      />
    </div>
  );
}
