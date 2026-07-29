import { createPortal } from 'react-dom';
import { MarkdownRenderer } from '../common/display/MarkdownRenderer';

interface TransitionWaitModalProps {
  open: boolean;
  /** Markdown shown while the follow-on is being prepared. */
  message: string;
}

/**
 * The hand-off bridge. After the viewer submits an escalation whose form opted
 * in via `x-lt-transition`, this holds the screen while the workflow creates and
 * assigns the next step. It is intentionally NOT dismissible — there is no wrong
 * button to press; either the follow-on arrives (useFollowMyClaims navigates and
 * this unmounts) or the detail page's timeout resolves it. Centered at every
 * breakpoint: a full-width sheet on narrow screens, a centered card on wide.
 */
export function TransitionWaitModal({ open, message }: TransitionWaitModalProps) {
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-text-primary/40 backdrop-blur-sm" />
      <div
        role="status"
        aria-live="polite"
        className="relative w-full max-w-sm bg-surface-raised border border-surface-border rounded-lg shadow-xl px-6 py-7 text-center"
      >
        <div className="flex justify-center mb-4" aria-hidden="true">
          <span className="inline-block w-7 h-7 rounded-full border-2 border-surface-border border-t-accent animate-spin" />
        </div>
        <div className="text-sm text-text-secondary [&_p]:m-0 [&_p+p]:mt-2">
          <MarkdownRenderer content={message} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
