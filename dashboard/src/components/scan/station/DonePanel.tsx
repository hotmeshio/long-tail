import { useEffect, useState } from 'react';
import { CircleCheck } from 'lucide-react';
import { SimpleMarkdown } from '../../common/display/SimpleMarkdown';
import { OpenButton } from './OpenButton';
import type { ScanOpenLink } from '../../../api/scan-codes';

/** Where the station goes after the done copy, and when. */
export interface DoneReturn {
  /** Epoch ms the station returns at. */
  at: number;
  /** A button that returns at once. */
  button?: string;
  onReturn: () => void;
}

function secondsUntil(at: number): number {
  return Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

/**
 * A write that landed at the bench: what to do with the item now ("Place it
 * in **C-12**."), large, until the next scan replaces it. Neutral surface;
 * the check carries the status. When the station returns on its own, the
 * seconds left show under the copy, beside the button that returns now.
 */
export function DonePanel({ markdown, nextPrompt, open, returning }: {
  markdown: string;
  nextPrompt: string;
  open?: ScanOpenLink;
  returning?: DoneReturn | null;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!returning) return;
    const interval = setInterval(() => setTick((t) => t + 1), 1_000);
    return () => clearInterval(interval);
  }, [returning]);

  return (
    <div
      role="status"
      className="flex-1 flex flex-col items-center justify-center text-center py-24 animate-page-enter"
      data-testid="done-panel"
    >
      <CircleCheck className="w-14 h-14 text-status-success-graphic mb-8" strokeWidth={1.25} />
      <div className="text-4xl font-light text-text-primary tracking-tight max-w-prose leading-snug">
        <SimpleMarkdown content={markdown} inherit />
      </div>
      <div className="w-16 border-t border-surface-border my-8" />
      <div className="text-lg text-text-secondary"><SimpleMarkdown content={nextPrompt} inherit /></div>
      {(open || returning?.button) && (
        <div className="flex items-center gap-4">
          {open && <OpenButton open={open} />}
          {returning?.button && (
            <button type="button" onClick={returning.onReturn} className="btn-primary mt-6" data-testid="done-return">
              {returning.button}
            </button>
          )}
        </div>
      )}
      {returning && (
        <p className="text-sm text-text-tertiary mt-6 tabular-nums" data-testid="done-countdown">
          Returning in {secondsUntil(returning.at)}s
        </p>
      )}
    </div>
  );
}
