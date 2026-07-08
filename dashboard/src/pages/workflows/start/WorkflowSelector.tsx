import { useState, useMemo } from 'react';
import { Bot, Clock, Server, Wrench } from 'lucide-react';
import { FilterBar, FilterSelect, FilterInput } from '../../../components/common/data/FilterBar';
import { WorkflowPill } from '../../../components/common/display/WorkflowPill';
import { NamespacePill } from '../../../components/common/display/NamespacePill';
import type { LTWorkflowConfig, WorkflowTier } from '../../../api/types';

export function WorkflowSelector({
  configs,
  selectedType,
  onSelect,
  tierMap,
  activeTypes,
}: {
  configs: LTWorkflowConfig[];
  selectedType: string;
  onSelect: (config: LTWorkflowConfig) => void;
  tierMap: Map<string, WorkflowTier>;
  activeTypes?: Set<string>;
}) {
  const [search, setSearch] = useState('');
  const [activeQueue, setActiveQueue] = useState<string | null>(null);

  const queues = useMemo(
    () => [...new Set(configs.map((c) => c.task_queue).filter(Boolean))].sort(),
    [configs],
  );

  // Group by task queue; workflows without a queue collect under a trailing section
  const grouped = useMemo(() => {
    const q = search.toLowerCase().trim();
    const matches = (c: LTWorkflowConfig) =>
      !q ||
      c.workflow_type.toLowerCase().includes(q) ||
      c.description?.toLowerCase().includes(q);

    const targetQueues = activeQueue ? [activeQueue] : queues;
    const sections = targetQueues
      .map((queue) => ({
        queue,
        workflows: configs.filter((c) => c.task_queue === queue && matches(c)),
      }))
      .filter((g) => g.workflows.length > 0);

    if (!activeQueue) {
      const noQueue = configs.filter((c) => !c.task_queue && matches(c));
      if (noQueue.length > 0) sections.push({ queue: '', workflows: noQueue });
    }
    return sections;
  }, [configs, queues, search, activeQueue]);

  return (
    <div>
      <FilterBar>
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
          placeholder={`${configs.length} workflows…`}
        />
      </FilterBar>

      {grouped.length === 0 ? (
        <p className="text-sm text-text-tertiary py-8 text-center">No workflows match your filter.</p>
      ) : (
        <div className="space-y-10">
          {grouped.map(({ queue, workflows }) => (
            <div key={queue || '__none__'}>
              <div className="sticky top-[60px] z-10 bg-surface flex items-center gap-2 py-2 mb-2 border-b border-surface-border">
                {queue ? (
                  <Server className="w-3 h-3 text-accent" strokeWidth={1.5} />
                ) : (
                  <Wrench className="w-3 h-3 text-text-quaternary" strokeWidth={1.5} />
                )}
                <h2 className="section-h2">{queue || 'No Queue'}</h2>
                <span className="text-xs text-text-quaternary">{workflows.length}</span>
              </div>
              <div className="divide-y divide-surface-border/30">
                {workflows.map((config) => (
                  <WorkflowRow
                    key={config.workflow_type}
                    config={config}
                    isSelected={selectedType === config.workflow_type}
                    tier={tierMap.get(config.workflow_type) ?? 'durable'}
                    cronActive={activeTypes?.has(config.workflow_type) ?? false}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkflowRow({
  config,
  isSelected,
  tier,
  cronActive,
  onSelect,
}: {
  config: LTWorkflowConfig;
  isSelected: boolean;
  tier: WorkflowTier;
  cronActive: boolean;
  onSelect: (config: LTWorkflowConfig) => void;
}) {
  const variant =
    tier === 'certified' ? 'certified' : tier === 'registered' ? 'registered' : 'durable';
  return (
    <button
      onClick={() => onSelect(config)}
      className="group relative w-full text-left py-2 px-3 -mx-3 rounded-md transition-colors duration-150"
    >
      {isSelected && (
        <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-accent rounded-full" />
      )}
      <div className="flex items-center gap-3">
        <WorkflowPill type={config.workflow_type} size="md" variant={variant} />
        {config.description && (
          <p className="flex-1 min-w-0 truncate text-[10px] text-text-tertiary group-hover:text-text-secondary transition-colors">
            {config.description}
          </p>
        )}
        <span className="ml-auto flex items-center gap-2 shrink-0">
          {config.execute_as && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] bg-accent/10 text-accent rounded">
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
        </span>
      </div>
    </button>
  );
}
