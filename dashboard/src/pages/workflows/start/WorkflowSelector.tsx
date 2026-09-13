import { useMemo } from 'react';
import { Bot, Clock, Play, Server, Wrench } from 'lucide-react';
import { WorkflowPill } from '../../../components/common/display/WorkflowPill';
import { NamespacePill } from '../../../components/common/display/NamespacePill';
import type { LTWorkflowConfig, WorkflowTier } from '../../../api/types';

const NO_QUEUE_LABEL = 'No Queue';

/** The queue set a filter offers — shared with the grouping below. */
export function workflowQueues(configs: LTWorkflowConfig[]): string[] {
  return [...new Set(configs.map((c) => c.task_queue).filter(Boolean))].sort() as string[];
}

/** One section per task queue; unqueued workflows trail under their own heading when no queue filter is active. */
export function groupWorkflows(
  configs: LTWorkflowConfig[],
  search: string,
  activeQueue: string | null,
): { queue: string; workflows: LTWorkflowConfig[] }[] {
  const q = search.toLowerCase().trim();
  const matches = (c: LTWorkflowConfig) =>
    !q || c.workflow_type.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q);

  const targetQueues = activeQueue ? [activeQueue] : workflowQueues(configs);
  const sections = targetQueues
    .map((queue) => ({ queue, workflows: configs.filter((c) => c.task_queue === queue && matches(c)) }))
    .filter((g) => g.workflows.length > 0);

  if (!activeQueue) {
    const noQueue = configs.filter((c) => !c.task_queue && matches(c));
    if (noQueue.length > 0) sections.push({ queue: '', workflows: noQueue });
  }
  return sections;
}

/** The first row of the unfiltered list — what the page preselects. */
export function firstWorkflowType(configs: LTWorkflowConfig[]): string | null {
  return groupWorkflows(configs, '', null)[0]?.workflows[0]?.workflow_type ?? null;
}

export function WorkflowSelector({
  configs,
  selectedType,
  onSelect,
  tierMap,
  activeTypes,
  search,
  activeQueue,
  compact = false,
}: {
  configs: LTWorkflowConfig[];
  selectedType: string;
  onSelect: (config: LTWorkflowConfig) => void;
  tierMap: Map<string, WorkflowTier>;
  activeTypes?: Set<string>;
  search: string;
  activeQueue: string | null;
  /** The narrow list column beside the form: name and tier only, headings in flow. */
  compact?: boolean;
}) {
  const grouped = useMemo(() => groupWorkflows(configs, search, activeQueue), [configs, search, activeQueue]);

  if (grouped.length === 0) {
    return <p className="text-sm text-text-tertiary py-8 text-center">No workflows match your filter.</p>;
  }

  return (
    <div className={compact ? 'space-y-6' : 'space-y-10'}>
      {grouped.map(({ queue, workflows }) => (
        <div key={queue || '__none__'}>
          <div className={`flex items-center gap-2 py-2 mb-1 border-b border-surface-border ${compact ? '' : 'sticky top-[60px] z-10 bg-surface mb-2'}`}>
            {queue ? (
              <Server className="w-3 h-3 text-accent shrink-0" strokeWidth={1.5} />
            ) : (
              <Wrench className="w-3 h-3 text-text-quaternary shrink-0" strokeWidth={1.5} />
            )}
            <h2 className="section-h2 truncate">{queue || NO_QUEUE_LABEL}</h2>
            <span className="text-xs text-text-quaternary">{workflows.length}</span>
          </div>
          <div className={compact ? '' : 'divide-y divide-surface-border/30'}>
            {workflows.map((config) => (
              <WorkflowRow
                key={config.workflow_type}
                config={config}
                isSelected={selectedType === config.workflow_type}
                tier={tierMap.get(config.workflow_type) ?? 'durable'}
                cronActive={activeTypes?.has(config.workflow_type) ?? false}
                onSelect={onSelect}
                compact={compact}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function WorkflowRow({
  config,
  isSelected,
  tier,
  cronActive,
  onSelect,
  compact,
}: {
  config: LTWorkflowConfig;
  isSelected: boolean;
  tier: WorkflowTier;
  cronActive: boolean;
  onSelect: (config: LTWorkflowConfig) => void;
  compact: boolean;
}) {
  const variant = tier === 'certified' ? 'certified' : tier === 'registered' ? 'registered' : 'durable';

  if (compact) {
    return (
      <button
        onClick={() => onSelect(config)}
        aria-current={isSelected ? 'true' : undefined}
        className={`group w-full text-left flex items-center gap-2 pl-3 pr-2 py-1.5 border-l-2 transition-colors ${
          isSelected ? 'border-accent bg-accent/10' : 'border-transparent hover:bg-surface-hover'
        }`}
      >
        <WorkflowPill type={config.workflow_type} size="sm" variant={variant} />
        {cronActive && (
          <span title="Cron schedule active" className="ml-auto shrink-0">
            <Clock className="w-3 h-3 text-status-success/70" />
          </span>
        )}
      </button>
    );
  }

  return (
    <button
      onClick={() => onSelect(config)}
      className="group relative w-full text-left py-2 px-3 -mx-3 rounded-md hover:bg-surface-hover/30 transition-colors duration-150"
    >
      {isSelected && (
        <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-accent rounded-full" />
      )}
      <div className="flex items-center gap-3">
        <WorkflowPill type={config.workflow_type} size="md" variant={variant} />
        {config.description && (
          <p className="flex-1 min-w-0 truncate text-2xs text-text-tertiary group-hover:text-text-secondary transition-colors">
            {config.description}
          </p>
        )}
        <span className="ml-auto flex items-center gap-2 shrink-0">
          {config.execute_as && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-2xs bg-accent/10 text-accent rounded">
              <Bot className="w-2.5 h-2.5" />
              {config.execute_as}
            </span>
          )}
          {cronActive && (
            <span title="Cron schedule active">
              <Clock className="w-3 h-3 text-status-success/70 shrink-0" />
            </span>
          )}
          <NamespacePill namespace="durable" />
          <span title="Configure & invoke">
            <Play
              className={`w-3 h-3 transition-opacity ${
                isSelected ? 'text-accent opacity-100' : 'text-accent opacity-0 group-hover:opacity-100'
              }`}
              strokeWidth={1.5}
            />
          </span>
        </span>
      </div>
    </button>
  );
}
