import { useMemo, useState } from 'react';
import type { ResolvedOption } from '../../../../lib/x-lt-options';

const MAX_SHOWN = 8;

/** Type-ahead state over an option list: the matches for the typed text, and the active one. */
export function useSuggestions(options: ResolvedOption[] | undefined, query: string, taken: ReadonlySet<unknown>) {
  const [active, setActive] = useState(-1);
  const matches = useMemo(() => {
    if (!options || query.trim() === '') return [];
    const q = query.trim().toLowerCase();
    return options
      .filter((o) => !taken.has(o.value) && (String(o.value).toLowerCase().includes(q) || o.label.toLowerCase().includes(q)))
      .slice(0, MAX_SHOWN);
  }, [options, query, taken]);
  const move = (delta: number) => setActive((a) => (matches.length === 0 ? -1 : (a + delta + matches.length) % matches.length));
  return { matches, active: Math.min(active, matches.length - 1), setActive, move, reset: () => setActive(-1) };
}
