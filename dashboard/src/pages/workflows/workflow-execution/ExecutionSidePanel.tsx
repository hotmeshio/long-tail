import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Info, Bell } from 'lucide-react';
import { SlidePanel, SlidePanelViews, PanelField, type SlidePanelView } from '../../../components/common/layout/SlidePanel';
import { StatusBadge } from '../../../components/common/display/StatusBadge';
import { CopyableId } from '../../../components/common/display/CopyableId';
import { DateValue } from '../../../components/common/display/DateValue';
import { DurationValue } from '../../../components/common/display/DurationValue';
import type { WorkflowExecution, LTTaskRecord, LTEscalationRecord } from '../../../api/types';

/**
 * Split a HotMesh compound entity key (taskQueue-workflowName) on the last '-'.
 * Workflow names are camelCase, so the last segment is always the workflow type.
 */
function splitEntityKey(compound: string): { taskQueue: string; workflowType: string } {
  const lastDash = compound.lastIndexOf('-');
  if (lastDash <= 0) return { taskQueue: compound, workflowType: compound };
  return {
    taskQueue: compound.substring(0, lastDash),
    workflowType: compound.substring(lastDash + 1),
  };
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">
      {children}
    </p>
  );
}

/**
 * A workflow can escalate to multiple targets, and multiple times across its
 * lifecycle — each escalation is its own row: role and type on the left, the
 * status badge in a right-aligned column, so a long history reads as a table
 * instead of running on.
 */
function EscalationRows({ escalations }: { escalations: LTEscalationRecord[] }) {
  return (
    <div>
      {escalations.map((esc) => (
        <Link
          key={esc.id}
          to={`/escalations/detail/${esc.id}`}
          className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 py-2 border-b border-surface-border/40 last:border-b-0 group"
        >
          <span className="min-w-0">
            <span className="block text-xs font-mono text-text-primary group-hover:text-accent transition-colors truncate" title={esc.type}>
              {esc.type}
            </span>
            <span className="block text-[10px] text-text-tertiary truncate">{esc.role}</span>
          </span>
          <DateValue date={esc.created_at} format="relative" className="text-[10px] text-text-tertiary whitespace-nowrap" />
          <span className="w-20 flex justify-end"><StatusBadge status={esc.status} /></span>
        </Link>
      ))}
    </div>
  );
}

function TaskRows({ tasks }: { tasks: LTTaskRecord[] }) {
  return (
    <div>
      {tasks.map((t) => (
        <Link
          key={t.id}
          to={`/workflows/tasks/detail/${t.id}`}
          className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 py-2 border-b border-surface-border/40 last:border-b-0 group"
        >
          <span className="min-w-0">
            <span className="block text-xs font-mono text-text-primary group-hover:text-accent transition-colors truncate" title={t.workflow_type}>
              {t.workflow_type}
            </span>
            <span className="block text-[10px] text-text-tertiary truncate">{t.lt_type}</span>
          </span>
          <DateValue date={t.created_at} format="relative" className="text-[10px] text-text-tertiary whitespace-nowrap" />
          <span className="w-20 flex justify-end"><StatusBadge status={t.status} /></span>
        </Link>
      ))}
    </div>
  );
}

/**
 * The execution detail side panel — the record's facts beside the timeline:
 *
 *   Details     — workflow identity, timing, and history metadata
 *   Escalations — every escalation the workflow raised, plus related tasks
 */
export function ExecutionSidePanel({
  execution,
  parentWorkflowId,
  childTasks,
  escalations,
  headerActions,
  open,
}: {
  execution: WorkflowExecution;
  parentWorkflowId: string | null;
  childTasks: LTTaskRecord[];
  escalations: LTEscalationRecord[];
  /** Page controls (toolbar, Actions menu) shown at the right of the icon row. */
  headerActions?: React.ReactNode;
  open: boolean;
}) {
  const hasRelated = escalations.length > 0 || childTasks.length > 0;
  const [activeView, setActiveView] = useState(hasRelated ? 'escalations' : 'details');

  const { taskQueue, workflowType } = splitEntityKey(execution.workflow_type);

  const views: SlidePanelView[] = [
    {
      id: 'details',
      icon: Info,
      label: 'Details',
      content: (
        <dl className="space-y-3.5">
          <PanelField label="Status"><StatusBadge status={execution.status} /></PanelField>
          <PanelField label="Workflow Type">
            <CopyableId bare value={workflowType} href={`/workflows/executions?entity=${encodeURIComponent(workflowType)}`} />
          </PanelField>
          <PanelField label="Workflow ID">
            <CopyableId bare value={execution.workflow_id} />
          </PanelField>
          {parentWorkflowId && (
            <PanelField label="Parent">
              <CopyableId bare value={parentWorkflowId} href={`/workflows/executions/${parentWorkflowId}`} />
            </PanelField>
          )}
          <PanelField label="Task Queue"><span className="font-mono">{taskQueue}</span></PanelField>
          <PanelField label="Start Time">
            {execution.start_time
              ? <DateValue date={execution.start_time} format="datetime" />
              : <span className="text-text-tertiary">--</span>}
          </PanelField>
          <PanelField label="End Time">
            {execution.close_time
              ? <DateValue date={execution.close_time} format="datetime" />
              : <span className="text-text-tertiary">--</span>}
          </PanelField>
          <PanelField label="Duration">
            <DurationValue ms={execution.duration_ms} className="font-mono" />
          </PanelField>
          <PanelField label="History Size">{execution.summary.total_events} events</PanelField>
          <PanelField label="Activities">
            {execution.summary.activities.completed} / {execution.summary.activities.total}
          </PanelField>
        </dl>
      ),
    },
    {
      id: 'escalations',
      icon: Bell,
      label: 'Escalations',
      content: (
        <div className="space-y-6">
          <div>
            <SectionLabel>Escalations</SectionLabel>
            {escalations.length > 0
              ? <EscalationRows escalations={escalations} />
              : <p className="text-xs text-text-tertiary italic">This workflow has not escalated.</p>}
          </div>
          {childTasks.length > 0 && (
            <div>
              <SectionLabel>Related Tasks</SectionLabel>
              <TaskRows tasks={childTasks} />
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <SlidePanel open={open} width={384} className="self-stretch">
      <div className="h-full pl-6">
        <SlidePanelViews
          views={views}
          activeId={activeView}
          onViewChange={setActiveView}
          headerActions={headerActions}
          stickyClassName="sticky top-0 z-10 h-[calc(100vh-5.25rem)] pt-9"
        />
      </div>
    </SlidePanel>
  );
}
