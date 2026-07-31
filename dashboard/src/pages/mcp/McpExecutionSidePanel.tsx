import { Info } from 'lucide-react';
import { SlidePanel, SlidePanelViews, PanelField, type SlidePanelView } from '../../components/common/layout/SlidePanel';
import { StatusBadge } from '../../components/common/display/StatusBadge';
import { CopyableId } from '../../components/common/display/CopyableId';
import { DateValue } from '../../components/common/display/DateValue';
import { DurationValue } from '../../components/common/display/DurationValue';

const STATUS_MAP: Record<string, string> = {
  running: 'in_progress',
  completed: 'completed',
  failed: 'failed',
};

/**
 * The pipeline-execution detail side panel — the run's facts beside the timeline,
 * the same shell the workflow-execution page uses. Identity, timing, the trace
 * link, and the activity counts that used to sit in a header card now live here;
 * the page's Actions menu and refresh toolbar ride the panel's header row.
 */
export function McpExecutionSidePanel({ execution, namespace, traceUrl, headerActions, open }: {
  execution: {
    workflow_id: string;
    workflow_type: string;
    status: string;
    start_time?: string | null;
    close_time?: string | null;
    duration_ms?: number | null;
    trace_id?: string | null;
    summary: {
      activities: { user: number; system: number };
      child_workflows: { total: number };
      timers: number;
      signals: number;
    };
  };
  namespace: string;
  traceUrl: string | null;
  /** Page controls (toolbar, Actions menu) shown at the right of the panel header. */
  headerActions?: React.ReactNode;
  open: boolean;
}) {
  const { summary } = execution;

  const views: SlidePanelView[] = [
    {
      id: 'details',
      icon: Info,
      label: 'Details',
      content: (
        <dl className="space-y-3.5">
          <PanelField label="Status"><StatusBadge status={STATUS_MAP[execution.status] ?? execution.status} /></PanelField>
          <PanelField label="Server"><span className="font-mono">{namespace || '—'}</span></PanelField>
          <PanelField label="Tool"><span className="font-mono">{execution.workflow_type || '—'}</span></PanelField>
          <PanelField label="Workflow ID"><CopyableId bare value={execution.workflow_id} /></PanelField>
          <PanelField label="Started">
            {execution.start_time
              ? <DateValue date={execution.start_time} format="datetime" />
              : <span className="text-text-tertiary">--</span>}
          </PanelField>
          <PanelField label="Completed">
            {execution.close_time
              ? <DateValue date={execution.close_time} format="datetime" />
              : <span className="text-text-tertiary">--</span>}
          </PanelField>
          <PanelField label="Duration"><DurationValue ms={execution.duration_ms} className="font-mono" /></PanelField>
          {execution.trace_id && (
            <PanelField label="Trace">
              <CopyableId
                bare
                value={execution.trace_id}
                href={traceUrl ? traceUrl.replace('{traceId}', execution.trace_id) : undefined}
                external
              />
            </PanelField>
          )}
          <PanelField label="Tools">{summary.activities.user}</PanelField>
          <PanelField label="System">{summary.activities.system}</PanelField>
          {summary.child_workflows.total > 0 && <PanelField label="Children">{summary.child_workflows.total}</PanelField>}
          {summary.timers > 0 && <PanelField label="Timers">{summary.timers}</PanelField>}
          {summary.signals > 0 && <PanelField label="Signals">{summary.signals}</PanelField>}
        </dl>
      ),
    },
  ];

  return (
    <SlidePanel open={open} width={384} className="h-full">
      <div className="h-full pl-6">
        <SlidePanelViews
          views={views}
          activeId="details"
          onViewChange={() => {}}
          headerActions={headerActions}
          stickyClassName="h-full min-h-0"
          labelInline
        />
      </div>
    </SlidePanel>
  );
}
