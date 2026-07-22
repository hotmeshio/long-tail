import { useMemo } from 'react';
import { Loader2, FileCode2, Rocket, PackageCheck, Plus, Minus } from 'lucide-react';
import type { PlanItem } from '../../../api/types';

interface PlanSidebarProps {
  plan: PlanItem[];
  namespaces: string[];
  yamlStatuses: Record<string, string>;
  activeWorkflow: string | null;
  isAddOpen?: boolean;
  onSelect: (name: string) => void;
  onAdd?: () => void;
}

function statusIcon(status: string | undefined) {
  const base = 'w-4 h-4 shrink-0';
  if (!status)
    return <Loader2 className={`${base} text-text-tertiary animate-spin`} strokeWidth={1.5} />;
  if (status === 'active')
    return <Rocket className={`${base} text-status-success`} strokeWidth={1.5} />;
  if (status === 'deployed')
    return <PackageCheck className={`${base} text-accent`} strokeWidth={1.5} />;
  if (status === 'draft')
    return <FileCode2 className={`${base} text-accent/75`} strokeWidth={1.5} />;
  return <Loader2 className={`${base} text-accent animate-spin`} strokeWidth={1.5} />;
}

export function PlanSidebar({ plan, namespaces, yamlStatuses, activeWorkflow, isAddOpen, onSelect, onAdd }: PlanSidebarProps) {
  const grouped = useMemo(() => {
    const groups: Record<string, PlanItem[]> = {};
    for (const item of plan) {
      (groups[item.namespace] ||= []).push(item);
    }
    return groups;
  }, [plan]);

  const showNsHeaders = namespaces.length > 1;

  return (
    <nav className="w-56 shrink-0 overflow-y-auto sticky top-0 self-start">
      <div className="flex items-center justify-between px-3 py-2">
        <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary">
          Pipeline Tools
        </p>
        {onAdd && (
          <button
            onClick={onAdd}
            className={`w-6 h-6 flex items-center justify-center rounded-full border transition-all duration-200 ${
              isAddOpen
                ? 'bg-accent/20 border-accent/40 text-accent rotate-0'
                : 'border-accent/30 text-accent/60 hover:bg-accent/10 hover:border-accent/50 hover:text-accent'
            }`}
            title={isAddOpen ? 'Cancel' : 'Add additional tools'}
          >
            {isAddOpen
              ? <Minus className="w-3 h-3" strokeWidth={2} />
              : <Plus className="w-3 h-3" strokeWidth={2} />
            }
          </button>
        )}
      </div>
      <div className="space-y-0.5">
        {namespaces.map((ns) => (
          <div key={ns}>
            {showNsHeaders && (
              <p className="px-3 pt-3 pb-1 text-2xs font-semibold uppercase tracking-widest text-text-tertiary">{ns}</p>
            )}
            {(grouped[ns] || []).map((item) => {
              const isActive = activeWorkflow === item.name;
              return (
                <button
                  key={item.name}
                  onClick={() => onSelect(item.name)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-md transition-colors duration-150 ${
                    isActive
                      ? 'bg-surface-hover text-text-primary'
                      : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'
                  }`}
                >
                  {statusIcon(yamlStatuses[item.name])}
                  <div className="min-w-0 text-left">
                    <span className="text-sm block truncate">{item.name}</span>
                    <span className="text-2xs text-text-tertiary block truncate">{item.description}</span>
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </nav>
  );
}
