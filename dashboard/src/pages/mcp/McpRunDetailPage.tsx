import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useMcpRunExecution, useInterruptJob } from '../../api/pipelines';
import { useSettings } from '../../api/settings';
import { JsonViewer } from '../../components/common/data/JsonViewer';
import { PageHeader } from '../../components/common/layout/PageHeader';
import { SegmentedTabs } from '../../components/common/layout/SegmentedTabs';
import { useCollapsedSections } from '../../hooks/useCollapsedSections';
import { useEventSubscription } from '../../hooks/useEventContext';
import { NATS_SUBJECT_PREFIX } from '../../lib/nats/config';
import { ListToolbar } from '../../components/common/data/ListToolbar';
import { PanelRightClose, PanelRightOpen, ChevronDown, Info, Activity, List } from 'lucide-react';

import { SwimlaneTimeline } from '../workflows/workflow-execution/SwimlaneTimeline';
import { EventTable } from '../workflows/workflow-execution/EventTable';
import { McpExecutionSidePanel } from './McpExecutionSidePanel';

type McpTab = 'details' | 'timeline' | 'events';
const MCP_TABS = ['details', 'timeline', 'events'] as const;
const MCP_TAB_KEY = 'lt:mcp-run-detail:tab';

// ── Actions dropdown ────────────────────────────────────────────────────────

function ActionsDropdown({ isRunning, onTerminate }: {
  isRunning: boolean;
  onTerminate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!isRunning) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-0.5 pl-2 pr-1 py-1 rounded-md text-2xs font-medium text-accent hover:text-accent-hover hover:bg-surface-hover transition-colors"
        title="Actions"
      >
        Actions
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-44 bg-surface-raised border border-surface-border rounded-md shadow-lg z-[100]">
          <button
            onClick={() => { onTerminate(); setOpen(false); }}
            className="block w-full text-left px-4 py-2 text-xs text-status-error hover:bg-surface-hover"
          >
            Terminate
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export function McpRunDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const [searchParams] = useSearchParams();
  const namespace = searchParams.get('namespace') || '';
  const queryClient = useQueryClient();
  const { data: execution, isLoading, error, refetch, isFetching } = useMcpRunExecution(jobId!, namespace);
  const interruptMutation = useInterruptJob();
  const { data: settings } = useSettings();
  const { isCollapsed, toggle } = useCollapsedSections('mcp-run-detail');

  const sidePanelOpen = !isCollapsed('side-panel');
  const traceUrl = settings?.telemetry?.traceUrl ?? null;

  // The main content is a segmented switch, not an accordion: one section at a
  // time, tabs at the top, the choice persisted across visits.
  const [tab, setTab] = useState<McpTab>(() => {
    try {
      const saved = localStorage.getItem(MCP_TAB_KEY) as McpTab | null;
      return saved && MCP_TABS.includes(saved) ? saved : 'details';
    } catch {
      return 'details';
    }
  });
  const selectTab = (next: McpTab) => {
    setTab(next);
    try { localStorage.setItem(MCP_TAB_KEY, next); } catch { /* private mode */ }
  };

  // Subscribe to activity events for this job — refetch execution on each step
  const activityHandler = useCallback((event: any) => {
    if (!jobId || event.workflowId !== jobId) return;
    queryClient.invalidateQueries({ queryKey: ['mcpRunExecution', jobId] });
  }, [jobId, queryClient]);
  useEventSubscription(`${NATS_SUBJECT_PREFIX}.system.>`, activityHandler);

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-surface-sunken rounded w-64" />
        <div className="h-60 bg-surface-sunken rounded" />
      </div>
    );
  }

  if (error || !execution) {
    return (
      <div>
        <PageHeader title="Pipeline Execution" />
        <div className="mt-4 text-center py-8">
          <p className="text-sm text-text-primary mb-1">
            {(error as Error)?.message?.includes('expired')
              ? 'Execution data is no longer available'
              : 'Unable to load execution'}
          </p>
          <p className="text-xs text-text-tertiary">
            {(error as Error)?.message ?? 'The run could not be resolved.'}
          </p>
        </div>
      </div>
    );
  }

  const { events } = execution;

  // The trigger activity's result is the effective input to the flow —
  // it accepts outside job input and provides it to descendant activities.
  const triggerCompleted = events.find(
    (e) => e.category === 'activity' && e.attributes.kind?.includes('completed'),
  );
  const triggerInput = triggerCompleted?.attributes.result ?? null;

  // Unwrap result — the `data` field is what users care about
  const rawResult = execution.result as Record<string, unknown> | null | undefined;
  const result = rawResult?.data ?? rawResult ?? null;

  return (
    // Master flow beside a full-height panel, mirroring the workflow-execution
    // page: the left column page-scrolls; the panel spans the middle row with
    // its own sticky viewport and bleeds to the page edge.
    <div className="flex items-stretch min-w-0 -mt-10 -mr-10 -mb-16">
      <div className="flex-1 min-w-0 pt-10 pr-10 pb-16">
        {/* The header stays quiet: title + the panel toggle. Facts, the toolbar,
            and the Actions menu all live in the panel. */}
        <PageHeader
          title="Pipeline Execution"
          actions={
            <button
              onClick={() => toggle('side-panel')}
              className="text-accent/60 hover:text-accent transition-colors"
              title={sidePanelOpen ? 'Hide side panel' : 'Show side panel'}
            >
              {sidePanelOpen
                ? <PanelRightClose className="w-5 h-5" strokeWidth={1.5} />
                : <PanelRightOpen className="w-5 h-5" strokeWidth={1.5} />}
            </button>
          }
        />

        {interruptMutation.error && (
          <div className="py-3 mb-6">
            <p className="text-xs text-status-error">
              Interrupt failed: {(interruptMutation.error as Error).message}
            </p>
          </div>
        )}

        <div>
          {/* The tab strip affixes to the top of the scroll as the section
              scrolls under it — the bg band hides the content passing beneath. */}
          <div className="sticky top-0 z-20 bg-surface pt-3 pb-3">
            <SegmentedTabs<McpTab>
              aria-label="Execution section"
              active={tab}
              onChange={selectTab}
              tabs={[
                { key: 'details', label: 'Details', icon: <Info className="w-3.5 h-3.5" /> },
                { key: 'timeline', label: 'Execution Timeline', icon: <Activity className="w-3.5 h-3.5" /> },
                { key: 'events', label: 'Events', icon: <List className="w-3.5 h-3.5" /> },
              ]}
            />
          </div>

          {/* One section at a time; the key restarts the reveal on each switch. */}
          <div key={tab} className="mt-4 animate-page-in">
            {tab === 'details' && (
              <div className="@container">
                <div className="grid grid-cols-1 @form-cols:grid-cols-2 gap-4">
                  <JsonViewer data={triggerInput ?? {}} label="Input" />
                  {result !== null && <JsonViewer data={result} label="Result" />}
                </div>
              </div>
            )}
            {tab === 'timeline' && (
              <SwimlaneTimeline events={events} outline jid={jobId} appId={namespace || 'durable'} />
            )}
            {tab === 'events' && (
              <EventTable events={events} jid={jobId} appId={namespace || 'durable'} />
            )}
          </div>
        </div>
      </div>

      <McpExecutionSidePanel
        execution={execution}
        namespace={namespace}
        traceUrl={traceUrl}
        headerActions={
          <>
            <ListToolbar
              onRefresh={() => refetch()}
              isFetching={isFetching}
              apiPath={`/pipelines/${jobId}/execution?app_id=${namespace}`}
            />
            <ActionsDropdown
              isRunning={execution.status === 'running'}
              onTerminate={() => {
                if (confirm('Interrupt this pipeline execution? This cannot be undone.')) {
                  interruptMutation.mutate(
                    { jobId: execution.workflow_id, topic: execution.workflow_type, appId: namespace },
                    { onSuccess: () => refetch() },
                  );
                }
              }}
            />
          </>
        }
        open={sidePanelOpen}
      />
    </div>
  );
}
