import { useState, useMemo } from 'react';
import { Search, Bot, Clock } from 'lucide-react';
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

  const filtered = useMemo(() => {
    if (!search.trim()) return configs;
    const q = search.toLowerCase();
    return configs.filter(
      (c) =>
        c.workflow_type.toLowerCase().includes(q) ||
        c.description?.toLowerCase().includes(q),
    );
  }, [configs, search]);

  return (
    <div>
      {/* Sticky header: search pill + section label — single block, no gap */}
      <div className="sticky top-0 z-20 bg-surface pt-4">
        <div className="bg-[#F7F7F7] rounded-lg px-4 py-2 mb-3">
          <div className="relative w-1/2">
            <Search className="absolute left-0 top-1/2 -translate-y-1/2 w-3 h-3 text-text-quaternary" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${configs.length} workflows…`}
              className="w-full pl-5 py-1 text-sm bg-transparent border-b border-surface-border/60 text-text-primary placeholder:text-text-quaternary focus:outline-none focus:border-accent/50 transition-colors"
            />
          </div>
        </div>
        <div className="flex items-center gap-2 py-2 border-b border-surface-border">
          <h2 className="section-h2">Workflows</h2>
          <span className="text-xs text-text-quaternary">{filtered.length}</span>
        </div>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <p className="text-sm text-text-tertiary py-8 text-center">No workflows match your search.</p>
      ) : (
        <div className="divide-y divide-surface-border/30">
          {filtered.map((config) => {
            const isSelected = selectedType === config.workflow_type;
            const tier = tierMap.get(config.workflow_type) ?? 'durable';
            const variant =
              tier === 'certified' ? 'certified' : tier === 'configured' ? 'configured' : 'durable';
            return (
              <button
                key={config.workflow_type}
                onClick={() => onSelect(config)}
                className="group relative w-full text-left py-3 px-3 -mx-3 rounded-md transition-colors duration-150"
              >
                {isSelected && (
                  <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-accent rounded-full" />
                )}
                <div className="flex items-center gap-2 mb-1">
                  <WorkflowPill type={config.workflow_type} size="md" variant={variant} />
                  <span className="ml-auto flex items-center gap-2 shrink-0">
                    {config.execute_as && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] bg-accent/10 text-accent rounded">
                        <Bot className="w-2.5 h-2.5" />
                        {config.execute_as}
                      </span>
                    )}
                    {activeTypes?.has(config.workflow_type) && (
                      <span title="Cron schedule active">
                        <Clock className="w-3 h-3 text-status-success/70 shrink-0" />
                      </span>
                    )}
                    <NamespacePill namespace="durable" />
                  </span>
                </div>
                {config.description && (
                  <p className="text-[10px] text-text-tertiary group-hover:text-text-secondary leading-relaxed line-clamp-2 pl-0.5 transition-colors">
                    {config.description}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
