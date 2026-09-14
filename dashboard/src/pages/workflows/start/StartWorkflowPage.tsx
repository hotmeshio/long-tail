import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInvocableWorkflows, useCronStatus } from '../../../api/workflows';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { FilterSelect, FilterInput } from '../../../components/common/data/FilterBar';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import type { InvocableWorkflow, WorkflowTier } from '../../../api/types';
import { WorkflowSelector, workflowQueues, firstWorkflowType } from './WorkflowSelector';
import { identifierToTitle } from '../../../lib/identifier-label';
import { StartNowPanel } from './StartNowPanel';

const TYPE_PARAM = 'type';
// A few dozen workflows read fine grouped by queue; the filters wait for scale to demand them.
const LIST_FILTERS_VISIBLE = false;

/**
 * Invoke — the list of workflows the caller may run beside the form for the
 * one chosen. The list is grouped by queue and takes a quarter of the row;
 * the form takes the rest. Selection lives in `?type=`, and the first row
 * is preselected so the page opens on a form, never on an empty column.
 */
export function StartWorkflowPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: invocable, isLoading } = useInvocableWorkflows();
  const { data: cronEntries } = useCronStatus();
  // Below xl the list and the form cannot share the row: the list folds
  // into a select and the form takes the full width.
  const compact = useMediaQuery('(max-width: 1279px)');

  const selectedType = searchParams.get(TYPE_PARAM) ?? '';
  const [search, setSearch] = useState('');
  const [activeQueue, setActiveQueue] = useState<string | null>(null);

  const workflows: InvocableWorkflow[] = invocable ?? [];
  const tierMap = useMemo(() => {
    const map = new Map<string, WorkflowTier>();
    for (const w of workflows) map.set(w.workflow_type, w.tier);
    return map;
  }, [workflows]);
  const selected = workflows.find((c) => c.workflow_type === selectedType);
  const activeTypes = new Set((cronEntries ?? []).filter((e) => e.active).map((e) => e.workflow_type));

  // A user's choice is a history entry; the opening preselect only rewrites the landing URL.
  const setType = useCallback(
    (value: string | null, opts: { replace?: boolean } = {}) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set(TYPE_PARAM, value);
          else next.delete(TYPE_PARAM);
          return next;
        },
        { replace: opts.replace ?? false },
      );
    },
    [setSearchParams],
  );

  useEffect(() => {
    if (searchParams.get(TYPE_PARAM) || workflows.length === 0) return;
    const first = firstWorkflowType(workflows);
    if (first) setType(first, { replace: true });
  }, [workflows, searchParams, setType]);

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-surface-sunken rounded w-48" />
        <div className="h-40 bg-surface-sunken rounded" />
      </div>
    );
  }

  const queues = workflowQueues(workflows);
  const form = selected
    ? <StartNowPanel selected={selected} />
    : <p className="text-xs text-text-tertiary">Choose a tool to begin.</p>;

  return (
    <div>
      <PageHeader title="Invoke Tool" docsHash="#docs:dashboard.md:invoke-tool" />

      {workflows.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-text-primary mb-1">No tools to invoke</p>
          <p className="text-xs text-text-tertiary">Mark workflows as invocable in the registry, or start the server with examples enabled.</p>
        </div>
      ) : compact ? (
        <>
          <label className="block mb-6 max-w-2xl">
            <span className="block text-2xs font-semibold uppercase tracking-widest text-text-tertiary mb-1">Tool</span>
            <select
              value={selectedType}
              onChange={(e) => setType(e.target.value || null)}
              className="select text-xs font-mono w-full"
            >
              <option value="">Choose a tool…</option>
              {queues.map((q) => (
                <optgroup key={q} label={identifierToTitle(q)}>
                  {workflows
                    .filter((c) => (c.task_queue || '') === q)
                    .map((c) => (
                      <option key={c.workflow_type} value={c.workflow_type}>{identifierToTitle(c.workflow_type)}</option>
                    ))}
                </optgroup>
              ))}
              {workflows
                .filter((c) => !c.task_queue)
                .map((c) => (
                  <option key={c.workflow_type} value={c.workflow_type}>{identifierToTitle(c.workflow_type)}</option>
                ))}
            </select>
          </label>
          {/* The form heading pulls itself up over the page gutter when stuck; give it that room here so it never covers the picker. */}
          <div className="pt-8">{form}</div>
        </>
      ) : (
        <div className="flex gap-10 items-start">
          {/* The page scrolls as a whole; the list column and the form's title and Start stick while the title of the page rides away. */}
          <aside className="w-1/4 min-w-[15rem] shrink-0 sticky top-0 self-start -mt-8 pt-8 max-h-[calc(100vh-5rem)] overflow-y-auto pr-1 space-y-4" data-testid="invoke-list">
            {LIST_FILTERS_VISIBLE && <div className="flex flex-col gap-3">
              {queues.length > 1 && (
                <FilterSelect
                  label="Queue"
                  value={activeQueue ?? ''}
                  onChange={(v) => setActiveQueue(v || null)}
                  options={queues.map((q) => ({ value: q, label: q }))}
                />
              )}
              <FilterInput
                label="Search"
                value={search}
                onChange={setSearch}
                placeholder={`${workflows.length} workflows…`}
              />
            </div>}
            <WorkflowSelector
              configs={workflows}
              selectedType={selectedType}
              onSelect={(c) => setType(c.workflow_type)}
              tierMap={tierMap}
              activeTypes={activeTypes}
              search={search}
              activeQueue={activeQueue}
              compact
            />
          </aside>
          <section className="flex-1 min-w-0">{form}</section>
        </div>
      )}
    </div>
  );
}
