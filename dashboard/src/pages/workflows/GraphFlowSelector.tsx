import { useState, useMemo } from 'react';
import { Search, GitBranch } from 'lucide-react';
import { ToolPill } from '../../components/common/display/ToolPill';
import { NamespacePill } from '../../components/common/display/NamespacePill';
import type { LTYamlWorkflowRecord } from '../../api/types';

export function GraphFlowSelector({
  flows,
  selectedId,
  onSelect,
}: {
  flows: LTYamlWorkflowRecord[];
  selectedId: string;
  onSelect: (flow: LTYamlWorkflowRecord) => void;
}) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return flows;
    const q = search.toLowerCase();
    return flows.filter(
      (f) =>
        f.graph_topic.toLowerCase().includes(q) ||
        f.description?.toLowerCase().includes(q) ||
        f.app_id?.toLowerCase().includes(q),
    );
  }, [flows, search]);

  return (
    <div>
      {/* Sticky header: search pill + section label — single block, no gap */}
      <div className="sticky top-0 z-20 bg-surface pt-4">
        <div className="bg-surface-sunken rounded-lg px-4 py-2 mb-3">
          <div className="relative w-1/2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-text-quaternary pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${flows.length} flows…`}
              className="input pl-8"
            />
          </div>
        </div>
        <div className="flex items-center gap-2 py-2 border-b border-surface-border">
          <GitBranch className="w-3 h-3 text-accent" strokeWidth={1.5} />
          <h2 className="section-h2">Graph Flows</h2>
          <span className="text-xs text-text-quaternary">{filtered.length}</span>
        </div>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <p className="text-sm text-text-tertiary py-8 text-center">No flows match your search.</p>
      ) : (
        <div className="divide-y divide-surface-border/30">
          {filtered.map((flow) => {
            const isSelected = selectedId === flow.id;
            return (
              <button
                key={flow.id}
                onClick={() => onSelect(flow)}
                className="group relative w-full text-left py-2 px-3 -mx-3 rounded-md transition-colors duration-150"
              >
                {isSelected && (
                  <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-accent rounded-full" />
                )}
                <div className="flex items-center gap-3">
                  <ToolPill name={flow.graph_topic} size="md" />
                  {flow.description && (
                    <p className="flex-1 min-w-0 truncate text-2xs text-text-tertiary group-hover:text-text-secondary transition-colors">
                      {flow.description}
                    </p>
                  )}
                  <span className="ml-auto shrink-0">
                    <NamespacePill namespace={flow.app_id} />
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
