import { CircleX } from 'lucide-react';
import { SimpleMarkdown } from '../../common/display/SimpleMarkdown';

/**
 * A refused scan, with nothing written. The words name what is wrong and,
 * when the rule knows it, where the item goes instead. It stays until the
 * next scan, so the associate can read it after looking up from the bench.
 */
export function RefusalPanel({
  markdown,
  expected,
}: {
  markdown: string;
  expected?: string[];
}) {
  return (
    <div
      role="alert"
      className="flex-1 flex flex-col items-center justify-center text-center py-24"
      data-testid="refusal-panel"
    >
      <CircleX className="w-12 h-12 text-status-error mb-8" strokeWidth={1.25} />
      <div className="text-2xl font-light text-text-primary tracking-tight max-w-prose">
        <SimpleMarkdown content={markdown} inherit />
      </div>
      {expected && expected.length > 0 && (
        <p className="text-base text-text-secondary mt-6">
          Expected <span className="font-mono text-text-primary">{expected.join(', ')}</span>
        </p>
      )}
      <div className="w-16 border-t border-surface-border my-8" />
      <p className="text-sm text-text-tertiary">Scan the right one to place it.</p>
    </div>
  );
}
