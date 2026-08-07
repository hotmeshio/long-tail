import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';
import { useWorkflowConfigs, useDiscoveredWorkflows, useCronStatus } from '../../../api/workflows';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { FilterBar, FilterSelect, FilterInput } from '../../../components/common/data/FilterBar';
import { useShellPanelOptional } from '../../../hooks/useShellPanel';
import type { LTWorkflowConfig, WorkflowTier } from '../../../api/types';
import { WorkflowSelector, workflowQueues } from './WorkflowSelector';
import { StartNowPanel } from './StartNowPanel';

// Shell-panel ownership key — the invoke form claims/releases this slot.
const INVOKE_PANEL_KEY = 'invoke-run';

/** The invoke form framed for the shell panel: small header with a close X. */
function InvokeRunPanel({
  config,
  executionsPath,
  onClose,
}: {
  config: LTWorkflowConfig;
  executionsPath: string;
  onClose: () => void;
}) {
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary">Invoke</p>
        <button onClick={onClose} className="icon-link" title="Close" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 pb-6 pt-1">
        <StartNowPanel selected={config} executionsPath={executionsPath} />
      </div>
    </div>
  );
}

export function StartWorkflowPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: configsData, isLoading } = useWorkflowConfigs();
  const { data: discoveredData, isLoading: discoveredLoading } = useDiscoveredWorkflows();
  const { data: cronEntries } = useCronStatus();
  const shell = useShellPanelOptional();

  const selectedType = searchParams.get('type') ?? '';
  // The list filters live at page level so the FilterBar spans the page —
  // the standard master-list geometry.
  const [search, setSearch] = useState('');
  const [activeQueue, setActiveQueue] = useState<string | null>(null);

  const configs: LTWorkflowConfig[] = configsData ?? [];

  const tierMap = useMemo(() => {
    const map = new Map<string, WorkflowTier>();
    for (const dw of discoveredData ?? []) {
      map.set(dw.workflow_type, dw.tier ?? 'durable');
    }
    return map;
  }, [discoveredData]);

  const invocableConfigs = useMemo(() => {
    const invocable = configs.filter((c) => c.invocable);
    const registeredTypes = new Set(configs.map((c) => c.workflow_type));
    const discovered = discoveredData ?? [];
    const durable = discovered
      .filter((dw) => dw.active && !registeredTypes.has(dw.workflow_type))
      .map((dw) => ({
        workflow_type: dw.workflow_type,
        task_queue: dw.task_queue ?? '',
        invocable: true,
        certified: false,
        description: null,
        default_role: 'reviewer',
        roles: [],
        invocation_roles: [],
        consumes: [],
        envelope_schema: null,
        resolver_schema: null,
        cron_schedule: null,
        execute_as: null,
      } satisfies LTWorkflowConfig));
    return [...invocable, ...durable];
  }, [configs, discoveredData]);

  const selectedConfig = invocableConfigs.find((c) => c.workflow_type === selectedType);

  const activeTypes = new Set(
    (cronEntries ?? []).filter((e) => e.active).map((e) => e.workflow_type),
  );

  const executionsPath = '/workflows/executions';

  const setType = useCallback(
    (value: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set('type', value);
          else next.delete('type');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const clearSelection = useCallback(() => setType(null), [setType]);

  useEffect(() => {
    if (invocableConfigs.length === 1 && !searchParams.get('type')) {
      setSearchParams({ type: invocableConfigs[0].workflow_type }, { replace: true });
    }
  }, [invocableConfigs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── ?type= ↔ shell panel sync ──────────────────────────────────────────────
  // The param is the source of truth: a change (row click, deep link,
  // back/forward) opens/closes the run panel in the shell's right slot; an
  // external close (the panel's X, slot takeover) clears the param. Refs
  // guard both directions against loops — the same pattern as EntityLensView.
  const appliedType = useRef<string | null>(null);
  const panelWasOpen = useRef(false);
  useEffect(() => {
    if (!shell) return;
    const type = selectedConfig ? selectedType : null;
    if (type === appliedType.current) return;
    appliedType.current = type;
    if (type && selectedConfig) {
      shell.setPanel(
        <InvokeRunPanel config={selectedConfig} executionsPath={executionsPath} onClose={clearSelection} />,
        { key: INVOKE_PANEL_KEY, width: 420 },
      );
    } else {
      panelWasOpen.current = false;
      shell.closePanel(INVOKE_PANEL_KEY);
    }
  }, [selectedType, selectedConfig, shell, clearSelection, executionsPath]);
  useEffect(() => {
    if (!shell || !selectedType) return;
    if (shell.open && shell.ownerKey === INVOKE_PANEL_KEY) {
      panelWasOpen.current = true;
      return;
    }
    if (panelWasOpen.current) {
      panelWasOpen.current = false;
      clearSelection();
    }
  }, [shell, selectedType, clearSelection]);
  // Unmount with the panel open releases the slot (keyed — never yanks
  // another claimant's panel).
  const shellRef = useRef(shell);
  shellRef.current = shell;
  useEffect(
    () => () => {
      if (appliedType.current) shellRef.current?.closePanel(INVOKE_PANEL_KEY);
    },
    [],
  );

  const handleSelect = (config: LTWorkflowConfig) => {
    setType(config.workflow_type);
  };

  if (isLoading || discoveredLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-surface-sunken rounded w-48" />
        <div className="h-40 bg-surface-sunken rounded" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Invoke" docsHash="#docs:dashboard.md:invoke-workflow" />

      {invocableConfigs.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-text-primary mb-1">No invocable workflows</p>
          <p className="text-xs text-text-tertiary">Mark workflows as invocable in the registry, or start the server with examples enabled.</p>
        </div>
      ) : (
        <>
          {/* The standard full-width sticky filter band — above the list. */}
          <FilterBar>
            {workflowQueues(invocableConfigs).length > 1 && (
              <FilterSelect
                label="Queue"
                value={activeQueue ?? ''}
                onChange={(v) => setActiveQueue(v || null)}
                options={workflowQueues(invocableConfigs).map((q) => ({ value: q, label: q }))}
              />
            )}
            <FilterInput
              label="Search"
              value={search}
              onChange={setSearch}
              placeholder={`${invocableConfigs.length} workflows…`}
            />
          </FilterBar>

          {/* The list IS the page — selecting a row opens the invoke form in
              the shell's right panel. */}
          <WorkflowSelector
            configs={invocableConfigs}
            selectedType={selectedType}
            onSelect={handleSelect}
            tierMap={tierMap}
            activeTypes={activeTypes}
            search={search}
            activeQueue={activeQueue}
          />
        </>
      )}
    </div>
  );
}
