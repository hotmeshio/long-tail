import { useEffect, useState } from 'react';
import { Package, ScanBarcode } from 'lucide-react';
import { SimpleMarkdown } from '../../common/display/SimpleMarkdown';
import type { StationSubject } from '../../../lib/scan-subject';

function secondsLeft(expiresAt: string): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000));
}

/**
 * The station holding an item. With a headline (where the item goes) the
 * destination leads, read from across the bench: the container code largest, its
 * place name under it, the item itself as a quiet line above. Without one,
 * the item leads. The subject lapses on its own (the scan pipeline clears it
 * at expiry); the per-second tick is a visible clock, not polling.
 */
export function HoldScreen({
  subject,
  primedName,
  progress,
  note,
  onRelease,
}: {
  subject: StationSubject;
  primedName: string | null;
  progress?: { filled: number; total: number; remaining: number } | null;
  /** The last act's done copy while the item is still held (a fill in progress). */
  note?: string | null;
  onRelease: () => void;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1_000);
    return () => clearInterval(interval);
  }, []);

  const destination = !!subject.headline;

  return (
    <div
      key={subject.escalationId}
      className="flex-1 flex flex-col items-center justify-center text-center py-16 animate-page-enter"
      data-testid="hold-screen"
    >
      {destination ? (
        <>
          <p className="text-sm text-text-tertiary">
            Holding <span className="font-mono text-text-secondary">{subject.label}</span>
          </p>
          <h1
            className="mt-6 font-mono font-light text-7xl leading-none tracking-tight text-text-primary max-w-full break-all"
            data-testid="hold-headline"
          >
            {subject.headline}
          </h1>
          {subject.subline && (
            <p className="heading-2 mt-4" data-testid="hold-subline">{subject.subline}</p>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center gap-4 mb-8">
            <Package className="w-10 h-10 text-accent-muted" strokeWidth={1} />
            <ScanBarcode className="w-8 h-8 text-text-quaternary" strokeWidth={1} />
          </div>
          <p className="text-sm text-text-tertiary">Holding</p>
          <h1 className="text-3xl font-light text-text-primary tracking-tight mt-1 font-mono">{subject.label}</h1>
        </>
      )}
      {subject.expect?.prompt ? (
        <div className="text-lg text-text-secondary mt-8 max-w-prose">
          <SimpleMarkdown content={subject.expect.prompt} inherit />
        </div>
      ) : (
        <p className="text-lg text-text-secondary mt-8">Scan where it goes</p>
      )}
      {note ? (
        <div className="text-base text-text-primary mt-4" data-testid="hold-progress">
          <SimpleMarkdown content={note} inherit />
        </div>
      ) : progress && progress.total > 0 && (
        <p className="text-base text-text-primary mt-4 tabular-nums" data-testid="hold-progress">
          {progress.filled} of {progress.total} checked off
        </p>
      )}
      {subject.claimedBy && (
        <p className="text-sm text-status-warning mt-4">Claimed by {subject.claimedBy.displayName}</p>
      )}
      <div className="w-16 border-t border-surface-border my-8" />
      <p className="text-sm text-text-tertiary">
        {primedName ? `Badge: ${primedName}` : 'Scan your badge when you place it'}
        <span className="mx-2">·</span>
        <span className="font-mono tabular-nums">{secondsLeft(subject.expiresAt)}s</span>
      </p>
      <button
        type="button"
        onClick={onRelease}
        className="mt-6 text-sm text-text-tertiary hover:text-text-secondary hover:underline"
      >
        Put it down
      </button>
    </div>
  );
}
