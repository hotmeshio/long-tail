import { useMemo } from 'react';
import { Loader2, FileCode2, Rocket, PackageCheck } from 'lucide-react';
import type { PlanItem } from '../../../api/types';

interface PlanSidebarProps {
  plan: PlanItem[];
  namespaces: string[];
  yamlStatuses: Record<string, string>;
  activeWorkflow: string | null;
  onSelect: (name: string) => void;
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

export function PlanSidebar({ plan, namespaces, yamlStatuses, activeWorkflow, onSelect }: PlanSidebarProps) {
  const grouped = useMemo(() => {
    const groups: Record<string, PlanItem[]> = {};
    for (const item of plan) {
      (groups[item.namespace] ||= []).push(item);
    }
    return groups;
  }, [plan]);

  const showNsHeaders = namespaces.length > 1;

  return (
    <nav className="w-56 shrink-0 overflow-y-auto">
      <p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
        Workflows
      </p>
      <div className="space-y-0.5">
        {namespaces.map((ns) => (
          <div key={ns}>
            {showNsHeaders && (
              <p className="px-3 pt-3 pb-1 text-[9px] font-semibold uppercase tracking-widest text-text-tertiary">{ns}</p>
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
                    <span className="text-[10px] text-text-tertiary block truncate">{item.description}</span>
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
