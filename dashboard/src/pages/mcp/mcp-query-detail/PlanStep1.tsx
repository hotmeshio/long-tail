import { Loader2, AlertCircle, GitBranch } from 'lucide-react';

interface PlanItem {
  name: string;
  role: string;
  description: string;
  dependencies: string[];
  build_order: number;
}

function roleLabel(role: string): string {
  switch (role) {
    case 'leaf': return 'Leaf';
    case 'composition': return 'Composition';
    case 'router': return 'Router';
    default: return role;
  }
}

interface PlanStep1Props {
  specification: string | undefined;
  description: string | null | undefined;
  plan: PlanItem[];
  isPlanning: boolean;
  isFailed: boolean;
  onContinue: () => void;
}

export function PlanStep1({ specification, description, plan, isPlanning, isFailed, onContinue }: PlanStep1Props) {
  return (
    <div className="space-y-6">
      {/* Original specification */}
      {specification && (
        <div>
          <label className="block text-2xs font-semibold uppercase tracking-widest text-text-tertiary mb-1">Specification</label>
          <div className="rounded-md bg-surface-sunken/50 px-4 py-3">
            <p className="text-xs font-mono text-text-primary leading-relaxed whitespace-pre-wrap">
              {specification}
            </p>
          </div>
        </div>
      )}

      {/* Planning spinner */}
      {isPlanning && (
        <div className="flex items-center gap-3 py-4">
          <Loader2 className="w-4 h-4 text-accent animate-spin" />
          <span className="text-sm text-text-secondary">Analyzing specification and generating plan...</span>
        </div>
      )}

      {isFailed && (
        <div className="flex items-center gap-3 p-4 rounded-lg border border-status-error/20 bg-status-error/5">
          <AlertCircle className="w-4 h-4 text-status-error" />
          <span className="text-sm text-status-error">Plan generation failed.</span>
        </div>
      )}

      {/* Plan description + workflow list */}
      {plan.length > 0 && (
        <div>
          {description && (
            <p className="text-sm text-text-secondary mb-4 leading-relaxed">{description}</p>
          )}
          <label className="block text-2xs font-semibold uppercase tracking-widest text-text-tertiary mb-2">
            Planned Workflows ({plan.length})
          </label>
          <div className="space-y-2">
            {plan.map((item) => (
              <div key={item.name} className="px-3 py-2.5 rounded-md bg-surface-raised/50">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-text-primary">{item.name}</span>
                  <span className="text-2xs px-1.5 py-0.5 rounded bg-surface-sunken text-text-tertiary">{roleLabel(item.role)}</span>
                </div>
                <p className="text-2xs text-text-secondary mt-1">{item.description}</p>
                {item.dependencies.length > 0 && (
                  <div className="flex items-center gap-1 mt-1">
                    <GitBranch className="w-2.5 h-2.5 text-text-tertiary" />
                    <span className="text-2xs text-text-tertiary">{item.dependencies.join(', ')}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!isPlanning && !isFailed && plan.length > 0 && (
        <button
          onClick={onContinue}
          className="px-4 py-2 bg-accent text-text-inverse text-xs font-medium rounded-md hover:bg-accent/90 transition-colors"
        >
          Continue to Profile
        </button>
      )}
    </div>
  );
}
