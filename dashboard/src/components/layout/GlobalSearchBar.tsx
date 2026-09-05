import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useSettings } from '../../api/settings';
import { apiFetch } from '../../api/client';
import { metadataFacetUrl } from '../../lib/facet-url';
import type { LTEscalationRecord } from '../../api/types';

/** Long-tail-owned lookups — always present ahead of the configured facets. */
export const BUILT_IN_SEARCH_FACETS = ['escalationId', 'workflowId'] as const;

/** Escalation ids are UUIDs — shape-checked here so a stray paste never
 *  costs a request (the server guards the same way). */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LAST_FACET_KEY = 'lt:search:facet';

/**
 * The navigation target for a facet search, or null when the value needs a
 * lookup first (escalationId/workflowId resolve against the API before
 * navigating). Pure so the routing rules are unit-testable without a router.
 */
export function buildSearchTarget(facet: string, value: string): string | null {
  if (facet === 'escalationId' || facet === 'workflowId') return null;
  return metadataFacetUrl(facet, value);
}

interface WorkflowLookup {
  escalations: LTEscalationRecord[];
}

/**
 * One-gesture search across every escalation of any status. A configured
 * metadata facet lands on the all-status table filtered by it; escalationId
 * opens the detail directly; workflowId opens its single escalation, lists
 * several, or links to the workflow execution when none exist.
 */
export function GlobalSearchBar() {
  const navigate = useNavigate();
  const { data: settings } = useSettings();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workflowHits, setWorkflowHits] = useState<LTEscalationRecord[] | null>(null);
  const [workflowFor, setWorkflowFor] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const facets = useMemo(
    () => [...BUILT_IN_SEARCH_FACETS, ...(settings?.search?.facets ?? [])
      .filter((f) => !(BUILT_IN_SEARCH_FACETS as readonly string[]).includes(f))],
    [settings],
  );
  const [facet, setFacet] = useState(() => {
    try {
      return localStorage.getItem(LAST_FACET_KEY) ?? BUILT_IN_SEARCH_FACETS[0];
    } catch {
      return BUILT_IN_SEARCH_FACETS[0];
    }
  });
  const activeFacet = facets.includes(facet) ? facet : facets[0];

  const selectFacet = (f: string) => {
    setFacet(f);
    setError(null);
    try {
      localStorage.setItem(LAST_FACET_KEY, f);
    } catch {
      /* best-effort */
    }
  };

  const reset = () => {
    setError(null);
    setWorkflowHits(null);
  };

  const submit = async () => {
    const q = value.trim();
    if (!q || busy) return;
    reset();

    const direct = buildSearchTarget(activeFacet, q);
    if (direct) {
      setValue('');
      navigate(direct);
      return;
    }

    if (activeFacet === 'escalationId' && !UUID_RE.test(q)) {
      setError('That is not a valid escalation id');
      return;
    }

    setBusy(true);
    try {
      if (activeFacet === 'escalationId') {
        await apiFetch(`/escalations/${encodeURIComponent(q)}`);
        setValue('');
        navigate(`/escalations/detail/${encodeURIComponent(q)}`);
      } else {
        const data = await apiFetch<WorkflowLookup>(`/escalations/by-workflow/${encodeURIComponent(q)}`);
        const rows = data?.escalations ?? [];
        if (rows.length === 1) {
          setValue('');
          navigate(`/escalations/detail/${rows[0].id}`);
        } else {
          // 0 → straight link to the execution; 2+ → the picker below.
          setWorkflowFor(q);
          setWorkflowHits(rows);
          if (rows.length === 0) setError(null);
        }
      }
    } catch {
      setError(`No ${activeFacet === 'escalationId' ? 'escalation' : 'workflow'} found for "${q}"`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="hidden md:flex items-center gap-1.5 min-w-0" data-testid="global-search">
      <Search className="w-3.5 h-3.5 shrink-0 text-text-quaternary" strokeWidth={1.5} />
      <select
        value={activeFacet}
        onChange={(e) => selectFacet(e.target.value)}
        aria-label="Search facet"
        className="bg-transparent text-2xs font-mono text-text-tertiary focus:outline-none cursor-pointer max-w-28 truncate"
      >
        {facets.map((f) => (
          <option key={f} value={f}>{f}</option>
        ))}
      </select>
      {/* The input owns a positioning context so the error line and the
          workflow results align exactly to its left edge — never drifting
          under the icon or the facet select. */}
      <div className="relative flex-1 min-w-0">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => { setValue(e.target.value); reset(); }}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          placeholder="Search…"
          aria-label="Global search"
          className="bg-transparent border-b border-surface-border focus:border-accent text-xs text-text-primary placeholder:text-text-quaternary focus:outline-none w-40 lg:w-56 py-0.5 transition-colors"
        />
        {busy && <span className="absolute right-1 top-1 text-2xs text-text-quaternary">…</span>}
        {error && (
          <p className="absolute top-full left-0 mt-1 text-2xs text-status-error whitespace-nowrap" role="alert">
            {error}
          </p>
        )}
        {workflowHits !== null && (
          <div className="absolute top-full left-0 mt-1.5 z-50 min-w-72 max-w-96 bg-surface-raised border border-surface-border rounded-md shadow-lg py-1" data-testid="search-workflow-results">
            {workflowHits.map((e) => (
              <Link
                key={e.id}
                to={`/escalations/detail/${e.id}`}
                onClick={() => { setWorkflowHits(null); setValue(''); }}
                className="block px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-hover truncate"
              >
                <span className="font-medium text-text-primary">{e.role}</span>
                <span className="mx-1.5 text-text-quaternary">·</span>
                {e.status}
                <span className="mx-1.5 text-text-quaternary">·</span>
                <span className="text-text-tertiary">{e.type}</span>
              </Link>
            ))}
            {workflowHits.length === 0 && (
              <p className="px-3 py-1.5 text-2xs text-text-tertiary">No escalations for this workflow.</p>
            )}
            <hr className="border-surface-border/60 my-0.5" />
            <Link
              to={`/workflows/executions/${encodeURIComponent(workflowFor)}`}
              onClick={() => { setWorkflowHits(null); setValue(''); }}
              className="block px-3 py-1.5 text-xs text-accent hover:bg-surface-hover"
            >
              Workflow execution →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
