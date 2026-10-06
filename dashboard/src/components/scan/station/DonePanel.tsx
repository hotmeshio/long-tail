import { CircleCheck } from 'lucide-react';
import { SimpleMarkdown } from '../../common/display/SimpleMarkdown';

/**
 * A write that landed at the bench: what to do with the item now ("Place it
 * in **C-12**."), large, until the next scan replaces it. Neutral surface;
 * the check carries the status.
 */
export function DonePanel({ markdown, nextPrompt }: { markdown: string; nextPrompt: string }) {
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
      <p className="text-lg text-text-secondary">{nextPrompt}</p>
    </div>
  );
}
