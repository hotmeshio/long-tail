import { useState, useRef, useEffect, useMemo } from 'react';
import { useUsers } from '../../../api/users';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';

export interface UserComboboxSelection {
  id: string;
  label: string;
}

/**
 * Searchable inline combobox for picking a user account. The filter drives the
 * server-side account search (name, email, external_id), so the list stays
 * bounded no matter how many accounts exist; a footer line discloses when more
 * matches remain than the page shows. Styled to match CapabilityCombobox.
 */
export function UserCombobox({ selected, onSelect, excludeIds = [], placeholder = 'Search users…' }: {
  selected: UserComboboxSelection | null;
  onSelect: (user: UserComboboxSelection | null) => void;
  /** Accounts to hide from the results (e.g. already assigned). */
  excludeIds?: string[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const debounced = useDebouncedValue(filter, 300);
  const PAGE = 20;
  const { data, isFetching } = useUsers({
    search: debounced.trim() || undefined,
    limit: PAGE,
  });

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const excluded = useMemo(() => new Set(excludeIds), [excludeIds]);
  const users = (data?.users ?? []).filter((u) => !excluded.has(u.id));
  const total = data?.total ?? 0;
  const truncated = total > (data?.users.length ?? 0);

  const displayValue = selected?.label ?? '';
  const filterText = open ? filter : displayValue;

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={filterText}
        onFocus={() => { setOpen(true); setFilter(''); }}
        onChange={(e) => {
          setFilter(e.target.value);
          if (!e.target.value) onSelect(null);
          if (!open) setOpen(true);
        }}
        placeholder={placeholder}
        className="input text-xs w-full min-w-0"
        aria-label="User"
      />

      {open && (
        <div className="absolute z-[100] left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-md border border-surface-border bg-surface shadow-lg">
          {users.map((u) => {
            const label = u.display_name || u.external_id;
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => {
                  onSelect({ id: u.id, label });
                  setFilter('');
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 hover:bg-surface-hover transition-colors flex items-center gap-3 min-w-0 ${
                  selected?.id === u.id ? 'bg-accent/5' : ''
                }`}
              >
                <span className="text-xs text-text-primary truncate">{label}</span>
                {u.email && (
                  <span className="text-2xs text-text-quaternary truncate">{u.email}</span>
                )}
              </button>
            );
          })}

          {users.length === 0 && (
            <p className="px-3 py-4 text-center text-2xs text-text-quaternary">
              {isFetching ? 'Searching…' : filter ? `No users match "${filter}"` : 'No users available'}
            </p>
          )}

          {truncated && (
            <p className="px-3 py-1.5 text-2xs text-text-quaternary border-t border-surface-border/60 tabular-nums">
              {users.length} of {total} — type to narrow
            </p>
          )}
        </div>
      )}
    </div>
  );
}
