import { IdCard, ScanBarcode } from 'lucide-react';
import { SimpleMarkdown } from '../../common/display/SimpleMarkdown';

/**
 * A scan that needs a badge first. The scan is held by the pipeline; the
 * badge scan primes the identity and the held scan replays on its own. The
 * order of scans never matters: item, badge, container and item, container,
 * badge both land.
 */
export function ScanBadgePrompt({
  what,
  notPrimedMarkdown,
  onCancel,
}: {
  what: string | null;
  notPrimedMarkdown?: string;
  onCancel: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center py-24" data-testid="scan-badge-prompt">
      <div className="flex items-center gap-4 mb-8">
        <ScanBarcode className="w-8 h-8 text-text-quaternary" strokeWidth={1} />
        <IdCard className="w-10 h-10 text-accent-muted" strokeWidth={1} />
      </div>
      <h2 className="text-2xl font-light text-text-primary tracking-tight">Scan your badge to finish</h2>
      {what && <p className="text-lg text-text-secondary mt-2 font-mono">{what}</p>}
      {notPrimedMarkdown && (
        <div className="text-sm text-text-tertiary mt-6 max-w-prose">
          <SimpleMarkdown content={notPrimedMarkdown} compact />
        </div>
      )}
      <div className="w-16 border-t border-surface-border my-8" />
      <button
        type="button"
        onClick={onCancel}
        className="text-sm text-text-tertiary hover:text-text-secondary hover:underline"
      >
        Cancel
      </button>
    </div>
  );
}
