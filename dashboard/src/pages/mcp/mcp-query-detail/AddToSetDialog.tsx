import { Loader2 } from 'lucide-react';

interface AddToSetDialogProps {
  isOpen: boolean;
  addSubmitted: boolean;
  addSpec: string;
  setAddSpec: (v: string) => void;
  planCount: number;
  isPending: boolean;
  isError: boolean;
  errorMessage: string | undefined;
  onSubmit: () => void;
  onCancel: () => void;
  onDismiss: () => void;
}

export function AddToSetDialog({
  isOpen,
  addSubmitted,
  addSpec,
  setAddSpec,
  planCount,
  isPending,
  isError,
  errorMessage,
  onSubmit,
  onCancel,
  onDismiss,
}: AddToSetDialogProps) {
  return (
    <div
      className="transition-all duration-300 ease-in-out grid"
      style={{
        gridTemplateRows: isOpen ? '1fr' : '0fr',
        opacity: isOpen ? 1 : 0,
        marginBottom: isOpen ? '24px' : '0px',
      }}
    >
      <div className="overflow-hidden">
      <div className="rounded-lg border border-accent/20 bg-gradient-to-b from-accent/[0.04] to-transparent p-5">
        {addSubmitted ? (
          <>
            <div className="flex items-center gap-3 py-6 justify-center">
              <Loader2 className="w-5 h-5 text-accent animate-spin" strokeWidth={1.5} />
              <div>
                <p className="text-sm font-medium text-text-primary">Building new tools...</p>
                <p className="text-[11px] text-text-tertiary mt-0.5">Watch the sidebar — new tools will appear as they're built.</p>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-text-tertiary">{planCount} tool{planCount === 1 ? '' : 's'} in set</span>
              <button
                onClick={onDismiss}
                className="text-[10px] text-text-tertiary hover:text-text-primary transition-colors"
              >
                Dismiss
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-text-primary mb-1">Expand this Toolset</p>
            <p className="text-[11px] text-text-tertiary mb-4">Describe additional activities you would like to add.</p>
            <textarea
              value={addSpec}
              onChange={(e) => {
                setAddSpec(e.target.value);
                const el = e.target;
                el.style.height = 'auto';
                el.style.height = `${Math.max(100, el.scrollHeight)}px`;
              }}
              placeholder="What else should this set do?"
              className="w-full min-h-[100px] px-3 py-2 bg-surface-sunken border border-surface-border rounded-md text-sm font-mono text-text-primary placeholder:text-text-tertiary/50 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent-primary"
              style={{ resize: 'none', overflow: 'hidden' }}
            />
            {isError && (
              <p className="text-xs text-status-error mt-2">{errorMessage}</p>
            )}
            <div className="flex items-center justify-between mt-3">
              <span className="text-[10px] text-text-tertiary">
                {planCount} tool{planCount === 1 ? '' : 's'} in set
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={onCancel}
                  className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={onSubmit}
                  disabled={!addSpec.trim() || isPending}
                  className="btn-primary text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isPending ? 'Submitting...' : 'Add to Set'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
      </div>
    </div>
  );
}
