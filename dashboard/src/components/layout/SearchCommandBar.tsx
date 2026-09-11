import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, ScanBarcode } from 'lucide-react';
import { useSettings } from '../../api/settings';
import { apiFetch } from '../../api/client';
import type { LTEscalationRecord } from '../../api/types';
import { useScanEnabled, useScanInput } from '../../hooks/useScanInput';
import { useScanCommands } from '../../hooks/useScanCommands';
import { SCAN_SOURCE_IDS } from '../../lib/scan-sources/types';
import {
  BUILT_IN_SEARCH_FACETS,
  SEARCH_MODE_KINDS,
  UUID_RE,
  buildCommandCode,
  buildSearchTarget,
  commandPrefix,
  loadSearchModeRef,
  modePlaceholder,
  resolveSearchMode,
  saveSearchModeRef,
  toModeRef,
  type SearchMode,
} from '../../lib/search-command';
import { normalizeScanCodeText } from '../scan/ScanPanel';
import { ScanOutcomeBody } from '../scan/ScanOutcomeBody';
import { SearchModePicker } from './SearchModePicker';

const OUTCOME_DISMISS_MS = 6_000;

interface WorkflowLookup {
  escalations: LTEscalationRecord[];
}

/**
 * One header input, two verbs. A Find mode looks an escalation up by id,
 * workflow, or a configured metadata facet. A Run mode composes a scan code
 * from a chosen rule plus the typed target and executes it exactly as a
 * scanner would. The trailing chip picks the mode.
 */
export function SearchCommandBar({ onOpenScanPanel }: { onOpenScanPanel?: () => void }) {
  const navigate = useNavigate();
  const { data: settings } = useSettings();
  const scanEnabled = useScanEnabled();
  const { submitCode, busy: scanBusy, lastResult } = useScanInput();
  const { commands } = useScanCommands(scanEnabled);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workflowHits, setWorkflowHits] = useState<LTEscalationRecord[] | null>(null);
  const [workflowFor, setWorkflowFor] = useState('');
  const [outcomeDismissedAt, setOutcomeDismissedAt] = useState<number | null>(null);
  const [modeRef, setModeRef] = useState(loadSearchModeRef);
  const inputRef = useRef<HTMLInputElement>(null);

  const facets = useMemo(() => {
    if (!settings?.search?.enabled) return [];
    const configured = (settings.search.facets ?? [])
      .filter((f) => !(BUILT_IN_SEARCH_FACETS as readonly string[]).includes(f));
    return [...BUILT_IN_SEARCH_FACETS, ...configured];
  }, [settings]);
  const mode = useMemo(() => resolveSearchMode(modeRef, facets, commands), [modeRef, facets, commands]);

  // A run that answered in place is narrated under the bar until typing resumes or time passes.
  const toolbarOutcome = lastResult?.source === SCAN_SOURCE_IDS.TOOLBAR && !lastResult.navigated
    && outcomeDismissedAt !== lastResult.at ? lastResult : null;
  useEffect(() => {
    if (!toolbarOutcome) return;
    const timer = setTimeout(() => setOutcomeDismissedAt(toolbarOutcome.at), OUTCOME_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toolbarOutcome]);

  const reset = () => {
    setError(null);
    setWorkflowHits(null);
    if (lastResult) setOutcomeDismissedAt(lastResult.at);
  };

  const selectMode = (next: SearchMode) => {
    const ref = toModeRef(next);
    setModeRef(ref);
    saveSearchModeRef(ref);
    reset();
    inputRef.current?.focus();
  };

  const runCommand = (activeMode: Extract<SearchMode, { kind: 'command' }>, target: string) => {
    const built = buildCommandCode(activeMode.command, normalizeScanCodeText(target));
    if ('error' in built) {
      setError(built.error);
      return;
    }
    setValue('');
    void submitCode(built.code, SCAN_SOURCE_IDS.TOOLBAR);
  };

  const lookup = async (facet: string, q: string) => {
    const direct = buildSearchTarget(facet, q);
    if (direct) {
      setValue('');
      navigate(direct);
      return;
    }
    if (facet === 'escalationId' && !UUID_RE.test(q)) {
      setError('That is not a valid escalation id');
      return;
    }
    setBusy(true);
    try {
      if (facet === 'escalationId') {
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
          setWorkflowFor(q);
          setWorkflowHits(rows);
        }
      }
    } catch {
      setError(`No ${facet === 'escalationId' ? 'escalation' : 'workflow'} found for "${q}"`);
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    const q = value.trim();
    if (!q || busy || scanBusy || !mode) return;
    reset();
    if (mode.kind === SEARCH_MODE_KINDS.COMMAND) runCommand(mode, q);
    else void lookup(mode.facet, q);
  };

  if (!mode) return null;
  const isCommand = mode.kind === SEARCH_MODE_KINDS.COMMAND;
  const working = busy || scanBusy;

  return (
    <div className="relative w-full max-w-[28rem]" data-testid="global-search">
      <div className="flex items-center h-8 bg-surface-field border border-surface-field-border rounded-[var(--lt-radius-field)] focus-within:border-accent focus-within:bg-surface-field-focus transition-colors">
        <label htmlFor="global-search-input" className="flex items-center gap-1.5 pl-2.5 shrink-0 cursor-text">
          {isCommand
            ? <ScanBarcode className="w-3.5 h-3.5 text-accent/65" strokeWidth={1.5} />
            : <Search className="w-3.5 h-3.5 text-text-quaternary" strokeWidth={1.5} />}
          {isCommand && (
            <span className="font-mono text-xs tabular-nums text-text-tertiary select-none" data-testid="search-command-prefix">
              {commandPrefix(mode.command)}
            </span>
          )}
        </label>
        <input
          ref={inputRef}
          id="global-search-input"
          type="text"
          value={value}
          onChange={(e) => { setValue(e.target.value); reset(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') { setValue(''); reset(); }
          }}
          placeholder={modePlaceholder(mode)}
          aria-label={isCommand ? 'Run target' : 'Global search'}
          autoComplete="off"
          spellCheck={false}
          className={`flex-1 min-w-0 h-full bg-transparent text-xs text-text-primary placeholder:text-text-quaternary focus:outline-none ${isCommand ? 'pl-0.5 pr-2 font-mono' : 'px-2'}`}
        />
        {working && <span className="w-1.5 h-1.5 mr-2 rounded-full bg-accent animate-pulse shrink-0" aria-label="Working" />}
        <SearchModePicker
          mode={mode}
          facets={facets}
          commands={commands}
          onSelect={selectMode}
          onOpenScanPanel={onOpenScanPanel}
        />
      </div>

      {error && (
        <p className="absolute top-full left-0 mt-1 text-2xs text-status-error whitespace-nowrap" role="alert">
          {error}
        </p>
      )}

      {toolbarOutcome && (
        <div
          role="status"
          className="absolute top-full left-0 mt-1.5 z-50 w-full max-w-96 bg-surface-raised border border-surface-border rounded-md shadow-lg px-3 py-2 animate-fade-in"
          data-testid="search-run-outcome"
        >
          <ScanOutcomeBody result={toolbarOutcome} compact />
        </div>
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
  );
}
