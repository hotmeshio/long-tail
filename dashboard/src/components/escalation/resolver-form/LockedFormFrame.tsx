import { useEffect, useState, type ReactNode } from 'react';
import { Lock } from 'lucide-react';

/** Animation length; a fallback timer clears state where animationend never fires. */
const HINT_MS = 2600;

/**
 * The locked form's interaction frame. A click reports the gesture (the page
 * nudges Claim) and answers right at the click point: a small toast pops in
 * above the cursor naming the state — "Claim this escalation to edit the
 * form", "Claimed by …", "resolved" — holds a beat, and drifts out. Children
 * arrive as a prop, so hint state re-renders only this frame, never the form
 * beneath it.
 */
export function LockedFormFrame({
  hint,
  onLockedClick,
  children,
}: {
  hint?: ReactNode;
  onLockedClick?: () => void;
  children: ReactNode;
}) {
  const [hintAt, setHintAt] = useState<{ x: number; y: number; n: number } | null>(null);

  useEffect(() => {
    if (!hintAt) return;
    const timer = setTimeout(() => setHintAt(null), HINT_MS);
    return () => clearTimeout(timer);
  }, [hintAt]);

  const handleClick = (e: React.MouseEvent) => {
    onLockedClick?.();
    if (hint) {
      // Keep the bubble on screen when the click hugs a viewport edge.
      const x = Math.min(Math.max(e.clientX, 96), window.innerWidth - 96);
      setHintAt((prev) => ({ x, y: e.clientY, n: (prev?.n ?? 0) + 1 }));
    }
  };

  return (
    <div className="pb-8 max-w-form" onClick={handleClick} data-testid="locked-form-frame">
      {children}
      {hint && hintAt && (
        <div
          // Keyed per click so a repeat click replays the pop at the new spot.
          key={hintAt.n}
          role="status"
          className="fixed z-[60] pointer-events-none flex items-center gap-2 px-3 py-1.5 rounded-md bg-surface-raised border border-surface-border shadow-lg text-xs font-medium text-text-primary whitespace-nowrap animate-[click-hint_2.6s_ease-in-out_both]"
          style={{ left: hintAt.x, top: hintAt.y - 12 }}
          onAnimationEnd={() => setHintAt(null)}
          data-testid="locked-form-hint"
        >
          <Lock className="w-3.5 h-3.5 text-accent shrink-0" strokeWidth={1.5} />
          {hint}
        </div>
      )}
    </div>
  );
}
