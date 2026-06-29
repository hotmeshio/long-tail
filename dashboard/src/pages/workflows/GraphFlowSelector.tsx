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
        <div className="bg-[#F7F7F7] rounded-lg px-4 py-2 mb-3">
          <div className="relative w-1/2">
            <Search className="absolute left-0 top-1/2 -translate-y-1/2 w-3 h-3 text-text-quaternary" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${flows.length} flows…`}
              className="w-full pl-5 py-1 text-sm bg-transparent border-b border-surface-border/60 text-text-primary placeholder:text-text-quaternary focus:outline-none focus:border-accent/50 transition-colors"
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
                className="group relative w-full text-left py-3 px-3 -mx-3 rounded-md transition-colors duration-150"
              >
                {isSelected && (
                  <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-accent rounded-full" />
                )}
                <div className="flex items-center gap-2 mb-0.5">
                  <ToolPill name={flow.graph_topic} size="md" />
                  <NamespacePill namespace={flow.app_id} />
                </div>
                {flow.description && (
                  <p className="text-[10px] text-text-tertiary group-hover:text-text-secondary leading-snug transition-colors pl-0.5">
                    {flow.description}
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
