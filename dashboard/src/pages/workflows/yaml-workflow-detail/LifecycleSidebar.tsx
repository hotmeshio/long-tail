import { SectionLabel } from '../../../components/common/layout/SectionLabel';

const LIFECYCLE_STEPS = ['draft', 'active', 'archived'] as const;
const LIFECYCLE_LABELS: Record<string, string> = {
  draft: 'Draft',
  active: 'Active',
  archived: 'Archived',
};

const LIFECYCLE_COLORS: Record<string, { filled: string; line: string }> = {
  draft:    { filled: 'bg-status-draft border-status-draft',     line: 'bg-status-draft/30' },
  active:   { filled: 'bg-status-success border-status-success', line: 'bg-status-success/30' },
  archived: { filled: 'bg-text-tertiary border-text-tertiary',   line: 'bg-text-tertiary/30' },
};

export function LifecycleSidebar({
  status,
  sourceWorkflowId,
  contentVersion,
  deployedContentVersion,
  onDeploy,
  onArchive,
  onDelete,
  onRegenerate,
  isPending,
  error,
}: {
  status: string;
  sourceWorkflowId?: string | null;
  contentVersion?: number;
  deployedContentVersion?: number | null;
  onDeploy: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onRegenerate: () => void;
  isPending: boolean;
  error?: string;
}) {
  // Treat 'deployed' as 'active' since deploy now auto-activates
  const effectiveStatus = status === 'deployed' ? 'active' : status;
  const currentIdx = LIFECYCLE_STEPS.indexOf(effectiveStatus as any);
  const needsRedeploy = contentVersion != null && contentVersion > (deployedContentVersion ?? 0);

  return (
    <div>
      <SectionLabel className="mb-4">Lifecycle</SectionLabel>

      {/* Out-of-sync warning */}
      {needsRedeploy && effectiveStatus !== 'draft' && effectiveStatus !== 'archived' && (
        <div className="mb-4 px-3 py-2 rounded-md bg-status-pending/10 border border-status-pending/30">
          <p className="text-[10px] font-semibold text-status-pending mb-1">YAML modified</p>
          <p className="text-[10px] text-text-secondary leading-relaxed">
            v{contentVersion} edited since deploy (v{deployedContentVersion}). Redeploy to apply changes.
          </p>
          <button onClick={onDeploy} disabled={isPending} className="mt-1.5 text-[10px] font-medium text-status-pending hover:underline">
            {isPending ? 'Deploying...' : 'Deploy now'}
          </button>
        </div>
      )}

      {/* Step sequence */}
      <div className="space-y-0">
        {LIFECYCLE_STEPS.map((step, idx) => {
          const isCurrent = step === effectiveStatus;
          const isDone = idx < currentIdx;
          const isFuture = idx > currentIdx;
          const isLast = idx === LIFECYCLE_STEPS.length - 1;
          const colors = LIFECYCLE_COLORS[step];

          return (
            <div key={step} className="flex items-stretch gap-3">
              {/* Vertical track */}
              <div className="flex flex-col items-center w-5 shrink-0">
                <span
                  className={`w-3 h-3 rounded-full shrink-0 border-2 transition-colors ${
                    isCurrent || isDone
                      ? colors.filled
                      : 'bg-surface-sunken border-surface-border'
                  }`}
                />
                {!isLast && (
                  <span className={`w-px flex-1 ${isDone ? colors.line : 'bg-surface-border'}`} />
                )}
              </div>

              {/* Label + action */}
              <div className={`pb-5 ${isLast ? 'pb-0' : ''}`}>
                <p className={`text-xs font-medium ${isCurrent ? 'text-text-primary' : isFuture ? 'text-text-tertiary' : 'text-text-secondary'}`}>
                  {LIFECYCLE_LABELS[step]}
                </p>
                {/* Show the next-step action */}
                {isCurrent && step === 'draft' && (
                  <div className="mt-2 flex items-center gap-2">
                    <button onClick={onDeploy} disabled={isPending} className="btn-primary text-[11px] px-3 py-1">
                      {isPending ? 'Deploying...' : 'Deploy'}
                    </button>
                    {sourceWorkflowId && (
                      <button onClick={onRegenerate} disabled={isPending} className="text-[10px] text-text-tertiary hover:text-text-primary">
                        Regenerate
                      </button>
                    )}
                  </div>
                )}
                {isCurrent && step === 'active' && (
                  <div className="mt-2 flex items-center gap-2">
                    <button onClick={onArchive} disabled={isPending} className="text-[11px] text-text-tertiary hover:text-status-error">
                      Archive
                    </button>
                    {sourceWorkflowId && (
                      <button onClick={onRegenerate} disabled={isPending} className="text-[10px] text-text-tertiary hover:text-text-primary">
                        Regenerate
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Version info */}
      {contentVersion != null && (
        <div className="mt-4 pt-4 border-t border-surface-border">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Content Version</p>
          <p className="text-xs font-mono text-text-primary">
            v{contentVersion}
            {deployedContentVersion != null && (
              <span className="text-text-tertiary ml-1.5">(deployed: v{deployedContentVersion})</span>
            )}
          </p>
        </div>
      )}

      {/* Delete -- only for draft/archived */}
      {(status === 'draft' || status === 'archived') && (
        <div className="mt-4 pt-4 border-t border-surface-border">
          <button onClick={onDelete} disabled={isPending} className="text-[11px] text-status-error hover:underline">
            Delete workflow tool
          </button>
        </div>
      )}

      {error && <p className="mt-3 text-[11px] text-status-error">{error}</p>}
    </div>
  );
}
