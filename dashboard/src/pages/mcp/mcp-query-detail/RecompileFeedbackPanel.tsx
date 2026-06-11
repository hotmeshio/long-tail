import { X } from 'lucide-react';

interface RecompileFeedbackPanelProps {
  feedbackText: string;
  setFeedbackText: (v: string) => void;
  dismissing: boolean;
  onClose: () => void;
  onRegenerate: () => void;
  isPending: boolean;
}

export function RecompileFeedbackPanel({
  feedbackText,
  setFeedbackText,
  dismissing,
  onClose,
  onRegenerate,
  isPending,
}: RecompileFeedbackPanelProps) {
  return (
    <div
      className="mb-4 p-4 bg-surface-sunken border border-surface-border rounded-lg overflow-hidden transition-all duration-250 ease-in-out"
      style={{
        animation: dismissing ? undefined : 'fadeIn 300ms ease-out both',
        opacity: dismissing ? 0 : 1,
        maxHeight: dismissing ? '0px' : '400px',
        paddingTop: dismissing ? '0px' : undefined,
        paddingBottom: dismissing ? '0px' : undefined,
        marginBottom: dismissing ? '0px' : undefined,
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">What should change?</p>
        <button onClick={onClose} className="text-text-tertiary hover:text-text-secondary transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <textarea value={feedbackText} onChange={(e) => setFeedbackText(e.target.value)}
        placeholder="E.g.: 'Only url, username, password, and screenshot_dir should be dynamic inputs. The steps array and script are implementation details.'"
        className="w-full min-h-[80px] px-3 py-2 bg-surface border border-surface-border rounded-md text-xs text-text-primary placeholder:text-text-tertiary resize-y focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent-primary" />
      <div className="flex items-center justify-between mt-2">
        <p className="text-[10px] text-text-tertiary">This feedback guides the compiler. The current graph definition will be replaced.</p>
        <button onClick={onRegenerate} disabled={!feedbackText.trim() || isPending} className="btn-primary text-xs shrink-0 ml-4">
          {isPending ? 'Recompiling...' : 'Recompile Pipeline'}
        </button>
      </div>
    </div>
  );
}
